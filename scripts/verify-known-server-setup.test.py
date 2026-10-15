import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock


specification = importlib.util.spec_from_file_location(
    "known_setup", Path(__file__).with_name("verify-known-server-setup.py"))
acceptance = importlib.util.module_from_spec(specification)
specification.loader.exec_module(acceptance)


class AcceptanceChecks(unittest.TestCase):
    def test_dependency_copy_preserves_internal_relative_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "installed"
            (source / "node_modules/.bin").mkdir(parents=True)
            package = source / "node_modules/package"
            package.mkdir()
            (package / "cli.js").write_text("native package-relative entrypoint")
            (source / "node_modules/.bin/launcher").symlink_to("../package/cli.js")
            target = root / "copied"
            acceptance.copy_installed_dependencies(source, target)
            launcher = target / "node_modules/.bin/launcher"
            self.assertTrue(launcher.is_symlink())
            self.assertEqual(launcher.resolve(), (target / "node_modules/package/cli.js").resolve())
            self.assertEqual(launcher.read_text(), "native package-relative entrypoint")

    def test_dependency_copy_rejects_absolute_and_escaping_links_before_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "installed"
            source.mkdir()
            outside = root / "live-resource"
            outside.write_text("untouched")
            for target in (str(outside), "../live-resource"):
                link = source / "launcher"
                link.symlink_to(target)
                with self.assertRaisesRegex(RuntimeError, "escapes the copied tree"):
                    acceptance.copy_installed_dependencies(source, root / "copied")
                self.assertFalse((root / "copied").exists())
                self.assertEqual(outside.read_text(), "untouched")
                link.unlink()

    def test_source_assertion_requires_body_and_rejects_checkout_leaks(self):
        acceptance.source_assertion({"source": "MainNative652 native652_main_source_body"}, "main")
        for value in ({"tools": ["find_symbol"]}, {"name": "MainNative652"},
                      {"source": "MainNative652 native652_main_source_body LinkedNative652"}):
            with self.assertRaises(RuntimeError):
                acceptance.source_assertion(value, "main")

    def test_descendants_excludes_foreign_processes_and_tracks_independent_groups(self):
        table = {10: (1, 10, "start"), 11: (10, 11, "start"), 12: (11, 11, "start"),
                 20: (1, 20, "start")}
        self.assertEqual(set(acceptance.descendants(10, table)), {10, 11, 12})

    def test_cli_accepts_positional_build_and_preserves_virtualenv_launcher(self):
        options = acceptance.arguments(["/tmp/build/index.js", "--codegraph", "/tmp/codegraph",
                                        "--crg", "/tmp/crg", "--serena", "/tmp/serena",
                                        "--serena-resources", "/tmp/resources"])
        self.assertEqual(options.cli, Path("/tmp/build/index.js"))
        self.assertEqual(options.crg, Path("/tmp/crg"))

    def test_cleanup_terminates_owned_process_group(self):
        process = subprocess.Popen([sys.executable, "-B", "-c", "import time; time.sleep(30)"],
                                   start_new_session=True)
        try:
            acceptance.stop_owned(process)
            self.assertIsNotNone(process.poll())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

    def test_cleanup_preserves_foreign_process(self):
        owned = subprocess.Popen([sys.executable, "-B", "-c", "import time; time.sleep(30)"],
                                 start_new_session=True)
        foreign = subprocess.Popen([sys.executable, "-B", "-c", "import time; time.sleep(30)"],
                                   start_new_session=True)
        try:
            acceptance.stop_owned(owned)
            self.assertIsNotNone(owned.poll())
            self.assertIsNone(foreign.poll())
        finally:
            acceptance.stop_owned(owned)
            acceptance.stop_owned(foreign)

    def test_cleanup_exited_leader_kills_term_resistant_group_child(self):
        child_code = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('ready',flush=True); time.sleep(30)"
        leader_code = (
            "import subprocess,sys; child=subprocess.Popen([sys.executable,'-B','-c'," + repr(child_code)
            + "],stdout=subprocess.PIPE,text=True); child.stdout.readline(); print(child.pid,flush=True)"
        )
        leader = subprocess.Popen([sys.executable, "-B", "-c", leader_code],
                                  stdout=subprocess.PIPE, text=True, start_new_session=True)
        child_pid = int(leader.stdout.readline())
        leader.wait(timeout=3)
        try:
            acceptance.stop_owned(leader)
            table = acceptance.process_table()
            self.assertTrue(child_pid not in table or "Z" in table[child_pid][3])
        finally:
            acceptance.stop_owned(leader)
            leader.stdout.close()

    def test_run_tracks_independent_native_child_after_leader_exits(self):
        child_code = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('ready',flush=True); time.sleep(30)"
        leader_code = (
            "import subprocess,sys,time; child=subprocess.Popen([sys.executable,'-B','-c'," + repr(child_code)
            + "],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,start_new_session=True); child.stdout.readline(); "
            "print(child.pid,flush=True); time.sleep(0.4)"
        )
        with tempfile.TemporaryDirectory() as root:
            runner = acceptance.Acceptance.__new__(acceptance.Acceptance)
            runner.root = Path(root)
            runner.options = SimpleNamespace(timeout=5)
            runner.env = None
            runner.report = {"commands": []}
            result = runner.run([sys.executable, "-B", "-c", leader_code])
            child_pid = int(result["stdout"])
            table = acceptance.process_table()
            self.assertTrue(child_pid not in table or "Z" in table[child_pid][3])

    def test_survivors_exclude_reused_pid_and_zombie(self):
        owned = {10: (1, 10, "original", "S"), 11: (1, 11, "original", "S")}
        current = {10: (1, 10, "different", "S"), 11: (1, 11, "original", "Z")}
        self.assertEqual(acceptance.owned_survivors(owned, current), {})

    def test_serena_uses_observed_repl_and_native_facade_documentation(self):
        runner = acceptance.Acceptance.__new__(acceptance.Acceptance)
        runner.checkouts = {"main": Path("/fixture/main")}
        runner.report = {"nativeSteps": []}
        native_source = {"result": "MainNative652 native652_main_source_body"}
        runner.call = Mock(side_effect=[{"result": "Your Serena session id is `native-session`"},
                                        {"result": "public facade docs"}, {"result": "native onboarding guidance"},
                                        native_source])
        result = runner.serena_query({"tools": [{"tool": "initial_instructions"}, {"tool": "serena_repl"}]},
                                     Path("/fixture/config.json"), "http://127.0.0.1", "main")
        acceptance.source_assertion(result, "main")
        calls = runner.call.call_args_list
        self.assertEqual([call.args[1] for call in calls],
                         ["initial_instructions", "serena_repl", "serena_repl", "serena_repl"])
        self.assertEqual(calls[1].args[2]["code"], 's.info("lsp.find_symbol", "mem.onboarding")')
        self.assertEqual(calls[2].args[2]["code"], "s.mem.onboarding()")
        self.assertIn("include_body=True", calls[3].args[2]["code"])
        self.assertEqual(calls[3].args[2]["session_id"], "native-session")


if __name__ == "__main__":
    unittest.main()
