#!/usr/bin/env python3
"""Reproduce Serena 2.0.0 preparation evidence; this is not a production helper."""

import argparse
import concurrent.futures
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from importlib.metadata import version
from pathlib import Path

# Keep installed backend packages read-only, including Python bytecode caches.
sys.dont_write_bytecode = True


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-root", type=Path, required=True,
                        help="Existing temporary directory; a new run directory is created inside it")
    parser.add_argument("--serena-home", type=Path, required=True,
                        help="Actual installed Serena home; dependencies are only read")
    parser.add_argument("--native-writer", choices=["A", "B"], help=argparse.SUPPRESS)
    return parser.parse_args()


def native_writer(root, name):
    from serena.config.serena_config import ProjectConfig, SerenaConfig

    config = ProjectConfig.load(root, serena_config=SerenaConfig())
    if name == "A":
        config.read_only = True
    else:
        config.initial_prompt = "foreign-writer-setting"
    (root / (name + ".loaded")).touch()
    deadline = time.monotonic() + 10
    while not (root / (name + ".save")).exists():
        if time.monotonic() > deadline:
            raise TimeoutError("Native writer fixture barrier")
        time.sleep(0.01)
    config.save(str(root / ".serena/project.yml"))


def prerequisites(home):
    if version("serena-agent") != "2.0.0":
        raise RuntimeError("Only installed serena-agent 2.0.0 is covered; no replacement is installed")
    resources = home / "language_servers/static/TypeScriptLanguageServer/ts-lsp/node_modules"
    for package, expected in [("typescript", "5.9.3"), ("typescript-language-server", "5.1.3")]:
        actual = json.loads((resources / package / "package.json").read_text())["version"]
        if actual != expected:
            raise RuntimeError(f"Installed {package} must be {expected}; got {actual}; no installation authorized")
    if not (resources / ".bin/typescript-language-server").is_file():
        raise RuntimeError("Missing native language server; no dependency installation authorized")
    if shutil.which("node") is None or shutil.which("npm") is None:
        raise RuntimeError("Missing Node.js/npm; no dependency installation authorized")
    return subprocess.run(["node", "--version"], check=True, capture_output=True, text=True).stdout.strip()


def git(checkout, *args):
    subprocess.run(["git", "-C", str(checkout), *args], check=True, capture_output=True, text=True)


def create_checkouts(root):
    main, linked, independent = [root / name for name in ["main", "linked", "independent"]]
    main.mkdir()
    independent.mkdir()
    git(main, "init", "-b", "fixture-main")
    (main / "unique.ts").write_text("export class Main651Unique {}\n")
    git(main, "add", "unique.ts")
    git(main, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
        "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture")
    git(main, "-c", "core.hooksPath=/dev/null", "worktree", "add", "-b", "fixture-linked", str(linked))
    (linked / "unique.ts").write_text("export class Linked651Unique {}\n")
    (independent / "unique.ts").write_text("export class Independent651Unique {}\n")
    git(independent, "init", "-b", "fixture-independent")
    return [main, linked, independent]


def constructor_evidence(checkout):
    from serena.config.serena_config import ProjectConfig, SerenaConfig
    from serena.project import Project
    from solidlsp.ls_config import LanguageServerRegistry

    project = Project(project_root=str(checkout),
                      project_config=ProjectConfig(project_name=checkout.name,
                          language_servers=[LanguageServerRegistry.get_instance().resolve("typescript")]),
                      serena_config=SerenaConfig())
    assert (checkout / ".serena/.gitignore").is_file()
    assert not (checkout / ".serena/project.yml").exists()
    assert not any(p.is_file() for p in (checkout / ".serena/memories").rglob("*"))
    return {"checkout": str(checkout), "native_constructor_wrote_gitignore": True,
            "native_constructor_created_empty_memories_directory": True,
            "project_yaml_created": False, "onboarding_files_created": [],
            "language_backend_status": project.get_language_server_manager_status()}


def query_evidence(checkout, home):
    from solidlsp.ls import SolidLanguageServer
    from solidlsp.ls_config import LanguageServerConfig, LanguageServerRegistry
    from solidlsp.settings import SolidLSPSettings

    started = time.monotonic()
    ls = SolidLanguageServer.create(
        LanguageServerConfig(ls_id=LanguageServerRegistry.get_instance().resolve("typescript"),
                             start_independent_lsp_process=False),
        str(checkout), timeout=10,
        solidlsp_settings=SolidLSPSettings(solidlsp_dir=str(home), project_data_path=str(checkout / ".serena")))
    try:
        ls.start()
        cold = [s["name"] for s in ls.request_document_symbols("unique.ts").root_symbols]
        cold_seconds = time.monotonic() - started
        started = time.monotonic()
        warm = [s["name"] for s in ls.request_document_symbols("unique.ts").root_symbols]
        warm_seconds = time.monotonic() - started
        dirty_name = checkout.name.title() + "Dirty651Unique"
        (checkout / "unique.ts").write_text("export class " + dirty_name + " {}\n")
        dirty = [s["name"] for s in ls.request_document_symbols("unique.ts").root_symbols]
        assert cold == [checkout.name.title() + "651Unique"], cold
        assert warm == cold, warm
        assert dirty == [dirty_name], dirty
        assert not any(p.is_file() for p in (checkout / ".serena/cache").rglob("*"))
        result = {"checkout": str(checkout), "source_bytes": (checkout / "unique.ts").stat().st_size,
                  "cold_symbols": cold, "warm_symbols": warm, "dirty_symbols": dirty,
                  "cold_seconds": round(cold_seconds, 4), "warm_seconds": round(warm_seconds, 4),
                  "disk_cache_files": []}
    finally:
        started = time.monotonic()
        ls.stop(shutdown_timeout=2)
    assert not ls.is_running(), "Owned native language server did not stop"
    result["native_orderly_stop_seconds"] = round(time.monotonic() - started, 4)
    return result


def writer_evidence(root, home):
    from serena.config.serena_config import ProjectConfig, SerenaConfig

    root.mkdir()
    (root / ".serena").mkdir()
    yaml = root / ".serena/project.yml"
    yaml.write_text("project_name: writers\nlanguages: [typescript]\n")
    before = yaml.read_bytes()
    config = ProjectConfig.load(root, serena_config=SerenaConfig())
    rewrote = before != yaml.read_bytes()
    assert rewrote, "Expected native load to migrate the incomplete fixture"
    config.read_only = False
    config.initial_prompt = ""
    config.save(str(yaml))
    children = []
    try:
        for name in ["A", "B"]:
            children.append(subprocess.Popen(
                [sys.executable, "-B", str(Path(__file__).resolve()), "--fixture-root", str(root),
                 "--serena-home", str(home), "--native-writer", name],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
        deadline = time.monotonic() + 10
        while not all((root / (name + ".loaded")).exists() for name in ["A", "B"]):
            if time.monotonic() > deadline:
                raise TimeoutError("Native writer load barrier")
            time.sleep(0.01)
        (root / "A.save").touch()
        _, error = children[0].communicate(timeout=5)
        assert children[0].returncode == 0, error
        after_a = ProjectConfig.load(root, serena_config=SerenaConfig())
        foreign_alive = children[1].poll() is None
        assert foreign_alive, "Unrelated native writer exited before its turn"
        (root / "B.save").touch()
        _, error = children[1].communicate(timeout=5)
        assert children[1].returncode == 0, error
        after_b = ProjectConfig.load(root, serena_config=SerenaConfig())
        assert after_a.read_only and not after_b.read_only
        assert after_b.initial_prompt == "foreign-writer-setting"
        return {"load_with_autogen_none_rewrote_project_yaml": rewrote,
                "writer_A_setting_lost": True, "writer_B_preserved_while_A_completed": foreign_alive,
                "after_writer_A": {"read_only": after_a.read_only, "initial_prompt": after_a.initial_prompt},
                "after_writer_B": {"read_only": after_b.read_only, "initial_prompt": after_b.initial_prompt}}
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=3)


def pure_generation_evidence(root):
    from serena.config.serena_config import ProjectConfig, SerenaConfig
    from solidlsp.ls_config import LanguageServerRegistry

    root.mkdir()
    (root / "unique.ts").write_text("export class PureGeneration651Unique {}\n")
    before = sorted(str(p.relative_to(root)) for p in root.rglob("*"))
    config = ProjectConfig.autogenerate(root, serena_config=SerenaConfig(),
        languages=[LanguageServerRegistry.get_instance().resolve("typescript")],
        save_to_disk=False, interactive=False, asynchronous=False)
    after = sorted(str(p.relative_to(root)) for p in root.rglob("*"))
    assert before == after
    assert [language.get_key() for language in config.language_servers] == ["typescript"]
    return {"changed_paths": [], "native_languages": ["typescript"], "project_config_published": False}


def main():
    args = arguments()
    if args.native_writer:
        native_writer(args.fixture_root.resolve(), args.native_writer)
        return
    node_version = prerequisites(args.serena_home.resolve())
    if not args.fixture_root.is_dir():
        raise RuntimeError("Fixture root must already be a temporary directory")
    root = Path(tempfile.mkdtemp(prefix="serena-native-", dir=args.fixture_root.resolve()))
    checkouts = create_checkouts(root)
    constructors = [constructor_evidence(checkout) for checkout in checkouts]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        queries = list(pool.map(lambda checkout: query_evidence(checkout, args.serena_home.resolve()), checkouts))
    import serena
    package_root = Path(serena.__file__).resolve().parent.parent
    sources = ["serena/config/serena_config.py", "serena/project.py", "serena/cli.py",
               "serena/ls_manager.py", "serena/agent.py", "serena/util/yaml.py",
               "solidlsp/ls.py", "solidlsp/ls_process.py", "solidlsp/ls_config.py", "solidlsp/util/cache.py",
               "solidlsp/language_servers/typescript_language_server.py"]
    evidence = {"scope": "native diagnostics only; full preparation support remains unresolved",
                "versions": {"serena": version("serena-agent"), "python": sys.version.split()[0],
                             "node": node_version, "typescript": "5.9.3", "typescript_language_server": "5.1.3"},
                "platform": sys.platform, "fixture_run": str(root), "installed_package_root": str(package_root),
                "source_sha256": {source: hashlib.sha256((package_root / source).read_bytes()).hexdigest() for source in sources},
                "constructors": constructors, "concurrent_native_queries": queries,
                "native_writer_settings_loss": writer_evidence(root / "writers", args.serena_home.resolve()),
                "pure_native_generation": pure_generation_evidence(root / "pure-generation"),
                "not_verified": ["production helper", "configured running Serena process readiness",
                                 "read-only effective global settings loading", "exclusive native project publication",
                                 "native cache writer coordination", "runtime job cancellation or deadlines",
                                 "foreign live process preservation under runtime cancellation",
                                 "unrelated-ready-tool responsiveness", "other languages/versions/platforms"]}
    output = json.dumps(evidence, indent=2)
    (root / "evidence.json").write_text(output + "\n")
    print(output)


if __name__ == "__main__":
    main()
