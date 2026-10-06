import asyncio
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import driver
from mcp import Client, StdioServerParameters, stdio_client


DRIVER = Path(__file__).with_name("driver.py")
DRIVER_TIMEOUT_SECONDS = 30
TYPESCRIPT_FIXTURE = DRIVER.parent.parent / "typescript/src/fixture.mjs"


@pytest.mark.parametrize("peer,protocol_era", [
    ("python", "legacy"), ("python", "modern"), ("v1", "legacy"),
    ("v2", "legacy"), ("v2", "modern"),
])
def test_peer_tool_contract(protocol_era: str, peer: str) -> None:
    command = (
        [sys.executable, str(DRIVER), "server", "--transport", "stdio"]
        if peer == "python"
        else [shutil.which("node"), str(TYPESCRIPT_FIXTURE), "server", "--sdk-era", peer,
              "--protocol-era", protocol_era, "--transport", "stdio"]
    )

    async def inspect_peer() -> None:
        async with Client(stdio_client(StdioServerParameters(command=command[0], args=command[1:])),
                          mode="auto" if protocol_era == "modern" else "legacy") as client:
            tools = (await client.list_tools(cache_mode="reload")).tools
            assert [tool.name for tool in tools] == ["fixture.acknowledge"]
            schema = tools[0].input_schema
            assert schema["type"] == "object"
            assert schema["required"] == ["marker"]
            assert schema["properties"]["marker"]["type"] == "string"
            result = await client.call_tool("fixture.acknowledge", {"marker": "fixture-input-must-not-leak"})
            assert not result.is_error
            assert [(item.type, item.text) for item in result.content] == [
                ("text", "fixture-result-must-not-leak")
            ]
            assert result.structured_content is None

    asyncio.run(asyncio.wait_for(inspect_peer(), DRIVER_TIMEOUT_SECONDS))


@pytest.mark.parametrize("sdk_era,protocol_era", [("v1", "legacy"), ("v2", "modern")])
def test_typescript_probe_invokes_python_peer(sdk_era: str, protocol_era: str) -> None:
    completed = subprocess.run(
        [shutil.which("node"), str(TYPESCRIPT_FIXTURE), "probe", "--sdk-era", sdk_era,
         "--protocol-era", protocol_era, "--transport", "stdio", "--command", sys.executable,
         "--arg", str(DRIVER), "--arg", "server", "--arg=--transport", "--arg", "stdio"],
        check=True, capture_output=True, text=True, timeout=DRIVER_TIMEOUT_SECONDS,
    )
    facts = json.loads(completed.stdout)
    assert facts["ok"] is True
    assert facts["operations"]["toolsList"] == {"count": 1, "fixtureTool": True}
    assert facts["operations"]["toolsCall"] == {"contentTypes": ["text"], "isError": False}
    assert "fixture-input-must-not-leak" not in completed.stdout + completed.stderr
    assert "fixture-result-must-not-leak" not in completed.stdout + completed.stderr


@pytest.mark.parametrize("protocol_era", ["legacy", "modern"])
def test_http_probe_sends_only_applicable_lifecycle(monkeypatch, capsys, protocol_era: str) -> None:
    server = subprocess.Popen(
        [sys.executable, str(DRIVER), "server", "--transport", "streamable-http",
         "--protocol-era", protocol_era], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    methods = []
    original_client = driver.httpx2.AsyncClient

    async def record_request(request) -> None:
        if request.method == "POST":
            message = json.loads(request.content)
            methods.append(message["method"])

    def recording_client(**kwargs):
        return original_client(**kwargs, event_hooks={"request": [record_request]})

    monkeypatch.setattr(driver.httpx2, "AsyncClient", recording_client)
    try:
        assert server.stdout is not None
        ready = json.loads(server.stdout.readline())
        asyncio.run(driver.probe(protocol_era, "streamable-http", ready["endpoint"], None, False))
        assert "tools/list" in methods and "tools/call" in methods
        if protocol_era == "modern":
            assert "server/discover" in methods
            assert not {"initialize", "notifications/initialized", "ping"}.intersection(methods)
        else:
            assert {"initialize", "notifications/initialized", "ping"}.issubset(methods)
        output = capsys.readouterr().out
        assert "fixture-input-must-not-leak" not in output
        assert "fixture-result-must-not-leak" not in output
    finally:
        stop_server(server)


def run_driver(*args: str) -> dict[str, object]:
    completed = subprocess.run(
        [sys.executable, str(DRIVER), *args],
        check=True,
        capture_output=True,
        text=True,
        timeout=DRIVER_TIMEOUT_SECONDS,
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
        [sys.executable, str(DRIVER), "server", "--transport", "stdio"]
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
        timeout=DRIVER_TIMEOUT_SECONDS,
    )
    assert "fixture-input-must-not-leak" not in completed.stdout
    assert "fixture-result-must-not-leak" not in completed.stdout
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


def test_modern_stdio_probe_accepts_applicable_operations() -> None:
    command = json.dumps(
        [sys.executable, str(DRIVER), "server", "--transport", "stdio"]
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
        "fixtureId": "python-sdk",
        "negotiatedRevision": "2026-07-28",
        "ok": True,
        "operations": ["server/discover", "tools/list", "tools/call"],
        "protocolEra": "modern",
        "toolsCount": 1,
        "transport": "stdio",
    }


def stop_server(server: subprocess.Popen[str]) -> None:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=5)


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
        stop_server(server)


def test_modern_streamable_http_probe_accepts_applicable_operations() -> None:
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
            "fixtureId": "python-sdk",
            "negotiatedRevision": "2026-07-28",
            "ok": True,
            "operations": ["server/discover", "tools/list", "tools/call"],
            "protocolEra": "modern",
            "toolsCount": 1,
            "transport": "streamable-http",
        }
    finally:
        stop_server(server)


def test_stdio_server_rejects_protocol_era() -> None:
    completed = subprocess.run(
        [sys.executable, str(DRIVER), "server", "--transport", "stdio", "--protocol-era", "legacy"],
        check=False,
        capture_output=True,
        text=True,
        timeout=DRIVER_TIMEOUT_SECONDS,
    )
    assert completed.returncode == 1
    assert json.loads(completed.stdout) == {"errorCode": "unsupported-profile", "fixtureId": "python-sdk"}


def test_invalid_probe_output_is_structural() -> None:
    secret = "synthetic-private-argument"
    completed = subprocess.run(
        [sys.executable, str(DRIVER), "probe", "--transport", "stdio", "--command-json", secret],
        check=False,
        capture_output=True,
        text=True,
        timeout=DRIVER_TIMEOUT_SECONDS,
    )
    assert completed.returncode == 1
    assert secret not in completed.stdout
    assert secret not in completed.stderr
    assert json.loads(completed.stdout) == {"errorCode": "invalid-command", "fixtureId": "python-sdk"}
