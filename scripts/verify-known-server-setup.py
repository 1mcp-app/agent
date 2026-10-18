#!/usr/bin/env python3
"""Acceptance for maintained setup examples using installed backends and built 1MCP.

python3 -B scripts/verify-known-server-setup.py --cli /absolute/build/index.js \
  --codegraph /absolute/bin/codegraph --crg /absolute/bin/code-review-graph \
  --serena /absolute/bin/serena --serena-resources /absolute/.serena

Use --preflight-only before the controller build is available. All writes go to a
new temporary directory. Native initialization is explicit acceptance activity,
not evidence of automatic preparation. No dependency installation is permitted.
Only the documented foreground native workflows are supported. Cleanup covers
owned process groups and observed descendants, not arbitrary rapidly daemonizing
commands that escape and reparent between process-table snapshots.
"""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


BACKENDS = ("codegraph", "code-review-graph", "serena")
SYMBOLS = {name: name.title() + "Native652" for name in ("main", "linked", "independent")}
MARKERS = {name: "native652_" + name + "_source_body" for name in SYMBOLS}


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build", nargs="?", type=Path, help="Built index.js (alternative to --cli)")
    parser.add_argument("--cli", type=Path)
    parser.add_argument("--codegraph", required=True, type=Path)
    parser.add_argument("--crg", required=True, type=Path)
    parser.add_argument("--serena", required=True, type=Path)
    parser.add_argument("--serena-resources", required=True, type=Path, help="Installed Serena home; read only")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--timeout", type=float, default=90)
    options = parser.parse_args(argv)
    if options.cli and options.build:
        parser.error("Supply --cli or positional build, not both")
    options.cli = options.cli or options.build
    if not options.preflight_only and options.cli is None:
        parser.error("A built --cli path is required for full acceptance")
    if options.timeout <= 0:
        parser.error("--timeout must be positive")
    return options


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def source_assertion(value, checkout):
    rendered = json.dumps(value, sort_keys=True)
    require(SYMBOLS[checkout] in rendered, "Missing checkout-specific symbol: " + checkout)
    require(MARKERS[checkout] in rendered, "Missing native source body: " + checkout)
    for other in SYMBOLS:
        if other != checkout:
            require(SYMBOLS[other] not in rendered, "Cross-checkout symbol leak: " + other)
            require(MARKERS[other] not in rendered, "Cross-checkout body leak: " + other)


def copy_installed_dependencies(source, destination):
    for link in source.rglob("*"):
        if link.is_symlink():
            require(not Path(os.readlink(link)).is_absolute()
                    and link.resolve(strict=True).is_relative_to(source.resolve()),
                    "Installed dependency link escapes the copied tree: " + str(link))
    shutil.copytree(source, destination, symlinks=True)


def process_table():
    result = subprocess.run(["ps", "-axo", "pid=,ppid=,pgid=,stat=,lstart="],
                            capture_output=True, text=True, check=True)
    table = {}
    for line in result.stdout.splitlines():
        fields = line.split(maxsplit=4)
        if len(fields) == 5:
            table[int(fields[0])] = (int(fields[1]), int(fields[2]), fields[4], fields[3])
    return table


def descendants(pid, table):
    owned = {pid}
    while True:
        expanded = owned | {child for child, record in table.items() if record[0] in owned}
        if expanded == owned:
            return {child: table[child] for child in owned if child in table}
        owned = expanded


class OwnedProcessTree:
    def __init__(self, process):
        self.process = process
        self.owned = {}
        self.group_retired = False
        self.error = None
        self.stopped = threading.Event()
        self.capture()
        self.thread = threading.Thread(target=self.watch, daemon=True)
        self.thread.start()

    def capture(self):
        table = process_table()
        roots = [pid for pid, record in self.owned.items()
                 if pid in table and table[pid][2] == record[2]]
        if not self.group_retired:
            members = {pid: record for pid, record in table.items() if record[1] == self.process.pid}
            if not members:
                self.group_retired = True
            for pid, record in members.items():
                self.owned.setdefault(pid, record)
            roots.extend(members)
        for root in roots:
            for pid, record in descendants(root, table).items():
                self.owned.setdefault(pid, record)

    def watch(self):
        while not self.stopped.wait(0.1):
            try:
                self.capture()
            except Exception as error:
                self.error = error
                return

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=2)
        self.capture()
        return dict(self.owned)


def owned_survivors(owned, table):
    return {pid: record for pid, record in owned.items()
            if pid in table and table[pid][2] == record[2] and "Z" not in table[pid][3]}


def stop_owned(process, tracker=None):
    tree = tracker or OwnedProcessTree(process)
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    tree.close()
    for native_signal in (signal.SIGTERM, signal.SIGKILL):
        tree.capture()
        survivors = owned_survivors(tree.owned, process_table())
        for pid in survivors:
            try:
                os.kill(pid, native_signal)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 3
        while True:
            process.poll()
            tree.capture()
            survivors = owned_survivors(tree.owned, process_table())
            if not survivors:
                require(tree.error is None, "Owned-process tracking failed: " + str(tree.error))
                return
            if time.monotonic() >= deadline:
                break
            time.sleep(0.05)
    require(False, "Owned native descendants remain after cleanup: " + str(sorted(survivors)))


class Acceptance:
    def __init__(self, options):
        self.options = options
        self.root = Path(tempfile.mkdtemp(prefix="1mcp-known-setup- &'-"))
        self.home = self.root / "home"
        self.home.mkdir()
        self.report = {
            "platform": platform.platform(), "fixtureRoot": str(self.root),
            "automaticPreparation": "not claimed or tested",
            "nativeSteps": [], "commands": [], "acceptance": [],
            "limits": ["TypeScript fixture only", "No hosted CI, deployment, or runtime production acceptance",
                       "Foreground workflows only; fast unobserved detached/reparented workers are unsupported",
                       "No automatic preparation freshness/writer/cancellation acceptance",
                       "Native onboarding instructions recorded; no fabricated memories"],
            "status": "running",
        }
        self.executables = {"codegraph": options.codegraph, "code-review-graph": options.crg,
                            "serena": options.serena}
        for executable in self.executables.values():
            require(executable.is_absolute() and executable.is_file() and os.access(executable, os.X_OK),
                    "Provide an existing absolute installed executable: " + str(executable))
        self.node = shutil.which("node")
        require(self.node is not None, "Installed Node.js is required; no downloads allowed")
        self.env = {"PATH": os.environ.get("PATH", os.defpath), "HOME": str(self.home),
                    "TMPDIR": str(self.root), "XDG_CONFIG_HOME": str(self.home / ".config"),
                    "XDG_CACHE_HOME": str(self.home / ".cache"), "XDG_DATA_HOME": str(self.home / ".local/share"),
                    "SERENA_HOME": str(self.home / ".serena"), "PYTHONDONTWRITEBYTECODE": "1",
                    "CODEGRAPH_NO_DOWNLOAD": "1", "CODEGRAPH_NO_DAEMON": "1",
                    "CODEGRAPH_NO_FAST_INIT": "1", "CODEGRAPH_TELEMETRY": "0", "NO_COLOR": "1",
                    "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                    "npm_config_offline": "true", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}
        guard = self.root / "no-install-bin"
        guard.mkdir()
        for command in ("npm", "npx", "pnpm", "yarn", "uv", "uvx", "pip", "pip3", "curl", "wget"):
            path = guard / command
            path.write_text("#!/bin/sh\necho 'Dependency installation/download forbidden by acceptance harness' >&2\nexit 97\n")
            path.chmod(0o755)
        self.env["PATH"] = str(guard) + os.pathsep + self.env["PATH"]

    def save(self):
        (self.root / "evidence.json").write_text(json.dumps(self.report, indent=2) + "\n")

    def run(self, argv, cwd=None, checked=True, timeout=None):
        command = [str(part) for part in argv]
        started = time.monotonic()
        with subprocess.Popen(command, cwd=cwd or self.root, env=self.env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              start_new_session=True) as process:
            tracker = OwnedProcessTree(process)
            timed_out = False
            try:
                stdout, stderr = process.communicate(timeout=timeout or self.options.timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                stop_owned(process, tracker=tracker)
                stdout, stderr = process.communicate(timeout=3)
            finally:
                stop_owned(process, tracker=tracker)
        record = {"argv": command, "cwd": str(cwd or self.root), "exit": process.returncode,
                  "timedOut": timed_out, "seconds": round(time.monotonic() - started, 3),
                  "stdout": stdout, "stderr": stderr}
        self.report["commands"].append(record)
        self.save()
        if checked:
            require(not timed_out and process.returncode == 0,
                    "Command failed; see evidence.json: " + " ".join(command))
        return record

    def preflight(self):
        specifications = {
            "codegraph": (["serve", "--help"], ["--path", "--mcp", "--no-watch"]),
            "code-review-graph": (["serve", "--help"], ["--repo"]),
            "serena": (["start-mcp-server", "--help"], ["--project", "--context", "--enable-web-dashboard"]),
        }
        for backend, (argv, flags) in specifications.items():
            result = self.run([self.executables[backend], *argv])
            for flag in flags:
                require(flag in result["stdout"], "Installed backend lacks required public flag " + flag)
            self.run([self.executables[backend], "--version"])
        resources = self.options.serena_resources
        require(resources.is_absolute(), "--serena-resources must be absolute")
        package_root = resources / "language_servers/static/TypeScriptLanguageServer/ts-lsp/node_modules"
        packages = {}
        for name, expected in (("typescript", "5.9.3"), ("typescript-language-server", "5.1.3")):
            manifest = package_root / name / "package.json"
            require(manifest.is_file(), "Missing installed Serena TypeScript prerequisite: " + str(manifest))
            packages[name] = json.loads(manifest.read_text())["version"]
            require(packages[name] == expected, "Unverified Serena dependency version: " + name)
        require((package_root / ".bin/typescript-language-server").is_file(),
                "Missing installed language-server launcher; no download attempted")
        require((package_root / "typescript/lib/tsserver.js").is_file(), "Missing installed TypeScript server entrypoint")
        self.run([self.node, "--version"])
        language_server = self.run([package_root / ".bin/typescript-language-server", "--version"])
        require(language_server["stdout"].strip() == packages["typescript-language-server"],
                "Installed language-server launcher does not match its manifest")
        self.report["serenaPrerequisites"] = packages
        self.report["launchRecipes"] = {
            "codegraph": ["serve", "--mcp", "--path", "CHECKOUT", "--no-watch"],
            "code-review-graph": ["serve", "--repo", "CHECKOUT"],
            "serena": ["start-mcp-server", "--project", "CHECKOUT", "--context", "ide",
                       "--enable-web-dashboard", "false", "--open-web-dashboard", "false"],
        }
        self.report["prerequisitesPassed"] = True

    def fixture_git(self, checkout, *argv):
        return self.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
                         "-c", "user.name=Native acceptance", "-c", "user.email=native@example.invalid",
                         "-C", checkout, *argv])

    def fixtures(self):
        self.checkouts = {name: self.root / name for name in SYMBOLS}
        for name in ("main", "independent"):
            self.checkouts[name].mkdir()
            self.fixture_git(self.checkouts[name], "init", "-q", "-b", "fixture-" + name)
            self.write_fixture(name)
            self.fixture_git(self.checkouts[name], "add", ".")
            self.fixture_git(self.checkouts[name], "commit", "-qm", "Isolated native acceptance fixture")
        self.fixture_git(self.checkouts["main"], "worktree", "add", "-qb", "fixture-linked", self.checkouts["linked"])
        self.write_fixture("linked")
        self.fixture_git(self.checkouts["linked"], "add", "unique.ts")
        self.fixture_git(self.checkouts["linked"], "commit", "-qm", "Distinct linked fixture")
        destination = self.home / ".serena/language_servers/static/TypeScriptLanguageServer"
        source = self.options.serena_resources / "language_servers/static/TypeScriptLanguageServer"
        copy_installed_dependencies(source / "ts-lsp", destination / "ts-lsp")
        copied = self.run([destination / "ts-lsp/node_modules/.bin/typescript-language-server", "--version"])
        require(copied["stdout"].strip() == self.report["serenaPrerequisites"]["typescript-language-server"],
                "Copied language-server launcher version differs from the installed prerequisite")
        self.report["serenaResources"] = "Copied installed TypeScript dependencies into isolated SERENA_HOME"

    def write_fixture(self, name):
        checkout = self.checkouts[name]
        (checkout / "unique.ts").write_text(
            'export function ' + SYMBOLS[name] + '(): string {\n  return "' + MARKERS[name] + '";\n}\n')
        (checkout / ".gitignore").write_text(".codegraph/\n.code-review-graph/\n.serena/\n")
        (checkout / "tsconfig.json").write_text(json.dumps({"compilerOptions": {"target": "ES2022"},
                                                           "include": ["unique.ts"]}) + "\n")

    def native_prepare(self, backend):
        for name, checkout in self.checkouts.items():
            if backend == "codegraph":
                argv = ["init", checkout, "--yes"]
            elif backend == "code-review-graph":
                argv = ["build", "--repo", checkout]
            else:
                argv = ["project", "create", checkout, "--language", "typescript"]
            self.report["nativeSteps"].append({"backend": backend, "checkout": name,
                                                "kind": "explicit native initialization, not automatic preparation",
                                                "argv": [str(self.executables[backend]), *map(str, argv)]})
            self.run([self.executables[backend], *argv], checkout)

    def cli(self, argv, config, cwd=None, checked=True, timeout=None):
        return self.run([self.node, self.options.cli, *argv, "--config", config,
                         "--config-dir", config.parent], cwd, checked, timeout)

    def install(self, backend, mode, checkout):
        directory = self.root / "configs" / backend / ("template" if mode == "template" else checkout.name)
        directory.mkdir(parents=True, exist_ok=True)
        config = directory / "mcp.json"
        sentinel = {"command": self.node, "args": ["--version"], "disabled": True,
                    "env": {"UNRELATED_SECRET": "${NATIVE_ACCEPTANCE_SECRET}"}}
        if not config.exists():
            config.write_text(json.dumps({"mcpServers": {"unrelated": sentinel}}, indent=2) + "\n")
        argv = ["mcp", "setup", "--known", backend, "--executable", self.executables[backend],
                "--name", backend]
        if mode == "static":
            argv += ["--checkout", checkout]
        before = config.read_bytes()
        self.cli([*argv, "--dry-run"], config)
        require(config.read_bytes() == before, "Dry run mutated configuration")
        self.cli(argv, config)
        applied = config.read_bytes()
        document = json.loads(applied)
        require(document["mcpServers"]["unrelated"] == sentinel, "Setup changed unrelated secret references/overrides")
        section = "mcpTemplates" if mode == "template" else "mcpServers"
        require(backend in document.get(section, {}), "Install did not create the requested target kind")
        if mode == "template":
            recipe = json.dumps(document[section][backend])
            for fixture in self.checkouts.values():
                require(str(fixture) not in recipe, "Reusable template was bound to a literal fixture path")
        self.cli(argv, config)
        require(config.read_bytes() == applied, "Repeated setup changed configuration bytes")
        self.cli([*argv, "--force"], config)
        require(config.read_bytes() == applied, "Equivalent forced setup changed configuration bytes")
        self.report["acceptance"].append({"backend": backend, "mode": mode, "phase": "setup",
                                          "dryRunUnchanged": True, "repeatUnchanged": True,
                                          "forceEquivalentUnchanged": True, "unrelatedPreserved": True,
                                          "config": str(config),
                                          "sha256": hashlib.sha256(applied).hexdigest()})
        return config

    def inspect(self, target, config, url, checkout):
        pagination = [] if "/" in target else ["--all"]
        return json.loads(self.cli(["inspect", target, *pagination, "--format", "json", "--url", url,
                                   "--project", checkout], config)["stdout"])

    def call(self, backend, tool, inputs, config, url, checkout):
        schema = self.inspect(backend + "/" + tool, config, url, checkout)
        require(schema.get("inputSchema", {}).get("type") == "object", "Missing public tool input schema")
        self.report.setdefault("toolSchemas", {})[backend + "/" + tool] = schema
        result = self.cli(["run", backend + "/" + tool, "--args", json.dumps(inputs),
                           "--format", "json", "--url", url, "--project", checkout], config)
        value = json.loads(result["stdout"])
        if isinstance(value, dict):
            require(not value.get("isError", False) and "error" not in value, "Native MCP tool returned an error")
        return value

    def native_query(self, backend, config, url, name):
        checkout = self.checkouts[name]
        inspection = self.inspect(backend, config, url, checkout)
        if inspection.get("loadTracked") and inspection.get("available") is not True:
            self.cli(["wait", backend, "--url", url, "--project", checkout, "--format", "json",
                      "--timeout", str(int(self.options.timeout * 1000))], config)
            inspection = self.inspect(backend, config, url, checkout)
        self.report.setdefault("materializationObservations", []).append({
            "backend": backend, "checkout": str(checkout), "config": str(config),
            "selection": "public inspect/run --project; no recipe replacement or backend path override",
            "serverInspection": inspection,
        })
        if backend == "codegraph":
            value = self.call(backend, "codegraph_explore", {"query": SYMBOLS[name], "maxFiles": 1},
                              config, url, checkout)
        elif backend == "code-review-graph":
            self.call(backend, "get_minimal_context_tool", {"task": "native acceptance", "base": "HEAD"},
                      config, url, checkout)
            value = self.call(backend, "get_review_context_tool",
                              {"changed_files": ["unique.ts"], "include_source": True, "base": "HEAD"},
                              config, url, checkout)
        else:
            value = self.serena_query(inspection, config, url, name)
        source_assertion(value, name)
        self.report["acceptance"].append({"backend": backend, "phase": "native source",
                                          "checkout": name, "config": str(config), "result": value})

    def serena_query(self, inspection, config, url, name):
        checkout = self.checkouts[name]
        tools = {item["tool"] for item in inspection["tools"]}
        require("initial_instructions" in tools, "Serena does not expose native instructions")
        instructions = self.call("serena", "initial_instructions", {}, config, url, checkout)
        inputs = {"name_path_pattern": SYMBOLS[name], "relative_path": "unique.ts", "include_body": True}
        record = {"backend": "serena", "checkout": name, "initialInstructions": instructions,
                  "onboarding": "Native guidance requested; full onboarding not claimed; no fabricated memories"}
        self.report["nativeSteps"].append(record)
        if "serena_repl" in tools:
            sessions = re.findall(r"Your Serena session id is `([^`]+)`", json.dumps(instructions))
            require(len(sessions) == 1, "Missing or ambiguous session id in Serena native instructions")
            def repl(code):
                return self.call("serena", "serena_repl", {"session_id": sessions[0], "code": code},
                                 config, url, checkout)
            record["interface"] = "public serena_repl facades"
            record["facadeDocumentation"] = repl('s.info("lsp.find_symbol", "mem.onboarding")')
            record["onboardingInstructions"] = repl("s.mem.onboarding()")
            record["nativeOnboardingSideEffects"] = "Backend may seed its own memory-maintenance guidance"
            return repl("s.lsp.find_symbol(" + ", ".join(key + "=" + repr(value)
                                                       for key, value in inputs.items()) + ")")
        require("find_symbol" in tools and "onboarding" in tools,
                "Serena lacks the expected public symbol/onboarding interface; inspect native guidance")
        record["interface"] = "public individual MCP tools"
        record["onboardingInstructions"] = self.call("serena", "onboarding", {}, config, url, checkout)
        return self.call("serena", "find_symbol", inputs, config, url, checkout)

    def runtime(self, backend, config, names):
        configuration_before = config.read_bytes()
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        url = "http://127.0.0.1:" + str(port)
        log_path = config.parent / "runtime.log"
        argv = [self.node, str(self.options.cli), "serve", "--transport", "http", "--host", "127.0.0.1",
                "--port", str(port), "--enable-auth", "false", "--config", str(config),
                "--config-dir", str(config.parent)]
        with log_path.open("w") as log:
            process = subprocess.Popen(argv, cwd=self.root, env=self.env, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=log, start_new_session=True)
            tracker = OwnedProcessTree(process)
            self.report.setdefault("runtimes", []).append({"argv": argv, "pid": process.pid, "log": str(log_path)})
            try:
                deadline = time.monotonic() + self.options.timeout
                while True:
                    require(process.poll() is None, "Owned runtime exited; see " + str(log_path))
                    with socket.socket() as probe:
                        ready = probe.connect_ex(("127.0.0.1", port)) == 0
                    if ready:
                        break
                    require(time.monotonic() < deadline, "Owned runtime listener timed out")
                    time.sleep(0.1)
                for name in names:
                    self.native_query(backend, config, url, name)
                if len(names) > 1:
                    self.native_query(backend, config, url, "main")
                require(config.read_bytes() == configuration_before,
                        "Configuration changed while selecting fresh checkouts")
                self.report["acceptance"].append({"backend": backend, "phase": "materialization",
                                                  "checkouts": names, "config": str(config),
                                                  "configBytesUnchanged": True,
                                                  "mainRecheckedAfterOtherCheckouts": len(names) > 1})
            finally:
                stop_owned(process, tracker=tracker)
                self.report["runtimes"][-1]["exit"] = process.returncode
                self.report["runtimes"][-1]["observedCleanup"] = {
                    "verified": True, "observedProcesses": len(tracker.owned),
                    "scope": "foreground process group and observed descendants only",
                }
                self.save()

    def execute(self):
        try:
            self.preflight()
            if self.options.preflight_only:
                self.report["status"] = "preflight passed; full acceptance not run"
                return
            require(self.options.cli.is_absolute() and self.options.cli.is_file(), "Supply the actual absolute built index.js")
            process_table()
            self.report["cli"] = {"path": str(self.options.cli),
                                  "sha256": hashlib.sha256(self.options.cli.read_bytes()).hexdigest()}
            self.fixtures()
            for backend in BACKENDS:
                try:
                    self.native_prepare(backend)
                    config = self.install(backend, "template", self.checkouts["main"])
                    self.runtime(backend, config, list(SYMBOLS))
                    for name, checkout in self.checkouts.items():
                        config = self.install(backend, "static", checkout)
                        self.runtime(backend, config, [name])
                except Exception as error:
                    self.report.setdefault("failures", []).append({"backend": backend, "error": str(error)})
                    self.save()
            require(not self.report.get("failures"), "Native acceptance failed; inspect evidence.json")
            self.report["status"] = "setup and native source acceptance passed; automatic preparation not verified"
        except Exception as error:
            self.report["status"] = "failed"
            self.report["error"] = str(error)
            raise
        finally:
            self.save()
            print(json.dumps({"evidence": str(self.root / "evidence.json"), "status": self.report["status"]}))


if __name__ == "__main__":
    Acceptance(arguments()).execute()
