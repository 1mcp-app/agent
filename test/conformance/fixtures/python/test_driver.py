import json
import subprocess
import sys
from pathlib import Path


DRIVER = Path(__file__).with_name("driver.py")


def run_driver(*args: str) -> dict[str, object]:
    completed = subprocess.run(
        [sys.executable, str(DRIVER), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_self_check_uses_imported_sdk_version() -> None:
    facts = run_driver("--self-check")
    assert facts == {
        "fixtureId": "python-sdk",
        "protocolEras": ["legacy", "modern"],
        "roles": ["client", "server"],
        "transports": ["stdio", "streamable-http"],
        "unsupportedProfiles": ["retained-http-sse", "protocol-2024-10-07"],
        "version": "2.0.0",
    }


def test_stdio_probe_exercises_protocol_without_payload_output() -> None:
    command = json.dumps(
        [sys.executable, str(DRIVER), "server", "--transport", "stdio", "--protocol-era", "legacy"]
    )
    completed = subprocess.run(
        [
            sys.executable,
            str(DRIVER),
            "probe",
            "--transport",
            "stdio",
            "--protocol-era",
            "legacy",
            "--command-json",
            command,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert "synthetic-private-argument" not in completed.stdout
    assert "synthetic-private-result" not in completed.stdout
    assert json.loads(completed.stdout) == {
        "callError": False,
        "fixtureId": "python-sdk",
        "initialized": True,
        "ok": True,
        "negotiatedRevision": "2025-11-25",
        "operations": ["initialize", "ping", "tools/list", "tools/call"],
        "ping": True,
        "protocolEra": "legacy",
        "toolsCount": 1,
        "transport": "stdio",
    }


def test_modern_stdio_probe_reports_removed_operations() -> None:
    command = json.dumps(
        [sys.executable, str(DRIVER), "server", "--transport", "stdio", "--protocol-era", "modern"]
    )
    facts = run_driver(
        "probe",
        "--transport",
        "stdio",
        "--protocol-era",
        "modern",
        "--command-json",
        command,
    )
    assert facts == {
        "callError": False,
        "classification": "unsupported-operation",
        "fixtureId": "python-sdk",
        "initialized": False,
        "negotiatedRevision": "2026-07-28",
        "ok": False,
        "operations": ["server/discover", "tools/list", "tools/call"],
        "ping": False,
        "protocolEra": "modern",
        "toolsCount": 1,
        "transport": "stdio",
        "unsupported": [
            {"operation": "initialize", "reason": "modern-uses-server-discover"},
            {"operation": "ping", "reason": "not-in-2026-07-28"},
        ],
    }


def test_streamable_http_probe_and_owned_teardown() -> None:
    server = subprocess.Popen(
        [
            sys.executable,
            str(DRIVER),
            "server",
            "--transport",
            "streamable-http",
            "--protocol-era",
            "legacy",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert server.stdout is not None
        ready = json.loads(server.stdout.readline())
        assert ready["ready"] is True
        facts = run_driver(
            "probe",
            "--transport",
            "streamable-http",
            "--protocol-era",
            "legacy",
            "--endpoint",
            ready["endpoint"],
        )
        assert "synthetic-private-argument" not in json.dumps(facts)
        assert "synthetic-private-result" not in json.dumps(facts)
        assert facts == {
            "callError": False,
            "fixtureId": "python-sdk",
            "initialized": True,
            "ok": True,
            "negotiatedRevision": "2025-11-25",
            "operations": ["initialize", "ping", "tools/list", "tools/call"],
            "ping": True,
            "protocolEra": "legacy",
            "toolsCount": 1,
            "transport": "streamable-http",
        }
    finally:
        server.terminate()
        server.wait(timeout=5)


def test_modern_streamable_http_probe_reports_removed_operations() -> None:
    server = subprocess.Popen(
        [
            sys.executable,
            str(DRIVER),
            "server",
            "--transport",
            "streamable-http",
            "--protocol-era",
            "modern",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert server.stdout is not None
        ready = json.loads(server.stdout.readline())
        facts = run_driver(
            "probe",
            "--transport",
            "streamable-http",
            "--protocol-era",
            "modern",
            "--endpoint",
            ready["endpoint"],
        )
        assert "synthetic-private-argument" not in json.dumps(facts)
        assert "synthetic-private-result" not in json.dumps(facts)
        assert ready["endpoint"] not in json.dumps(facts)
        assert facts == {
            "callError": False,
            "classification": "unsupported-operation",
            "fixtureId": "python-sdk",
            "initialized": False,
            "negotiatedRevision": "2026-07-28",
            "ok": False,
            "operations": ["server/discover", "tools/list", "tools/call"],
            "ping": False,
            "protocolEra": "modern",
            "toolsCount": 1,
            "transport": "streamable-http",
            "unsupported": [
                {"operation": "initialize", "reason": "modern-uses-server-discover"},
                {"operation": "ping", "reason": "not-in-2026-07-28"},
            ],
        }
    finally:
        server.terminate()
        server.wait(timeout=5)


def test_invalid_probe_output_is_structural() -> None:
    secret = "synthetic-private-argument"
    completed = subprocess.run(
        [sys.executable, str(DRIVER), "probe", "--transport", "stdio", "--command-json", secret],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 1
    assert secret not in completed.stdout
    assert secret not in completed.stderr
    assert json.loads(completed.stdout) == {"errorCode": "invalid-command", "fixtureId": "python-sdk"}
