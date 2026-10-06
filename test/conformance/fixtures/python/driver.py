from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import socket
import sys
from collections.abc import Sequence
from contextlib import AsyncExitStack

import httpx2
from mcp import Client, StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client
from mcp.server import MCPServer
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


FIXTURE_ID = "python-sdk"
EXPECTED_VERSION = "2.0.0"
TOOL_NAME = "fixture.acknowledge"
TOOL_INPUT_SENTINEL = "fixture-input-must-not-leak"
TOOL_RESULT_SENTINEL = "fixture-result-must-not-leak"
LEGACY_REVISIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

server = MCPServer("one-mcp-python-conformance-fixture", version="1", log_level="ERROR")


@server.tool(name=TOOL_NAME, structured_output=False)
def fixture_acknowledge(marker: str) -> str:
    """Acknowledges a synthetic conformance request."""
    del marker
    return TOOL_RESULT_SENTINEL


def emit(value: dict[str, object]) -> None:
    print(json.dumps(value, sort_keys=True, separators=(",", ":")), flush=True)


def self_check() -> None:
    version = importlib.metadata.version("mcp")
    if version != EXPECTED_VERSION:
        raise FixtureError("sdk-version-mismatch")
    emit(
        {
            "fixtureId": FIXTURE_ID,
            "protocolEras": ["legacy", "modern"],
            "roles": ["client", "server"],
            "transports": ["stdio", "streamable-http"],
            "unsupportedProfiles": ["retained-http-sse", "protocol-2024-10-07"],
            "version": version,
        }
    )


class FixtureError(Exception):
    pass


class FixtureArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        del message
        raise FixtureError("invalid-arguments")


def parse_command(value: str) -> list[str]:
    try:
        command = json.loads(value)
    except json.JSONDecodeError as error:
        raise FixtureError("invalid-command") from error
    if not isinstance(command, list) or not command or not all(isinstance(item, str) for item in command):
        raise FixtureError("invalid-command")
    return command


async def probe(
    protocol_era: str,
    transport_name: str,
    endpoint: str | None,
    command_json: str | None,
    aggregated: bool,
) -> None:
    try:
        async with AsyncExitStack() as stack:
            if transport_name == "stdio":
                if command_json is None:
                    raise FixtureError("invalid-command")
                command = parse_command(command_json)
                transport = stdio_client(StdioServerParameters(command=command[0], args=command[1:]))
            elif transport_name == "streamable-http":
                if endpoint is None:
                    raise FixtureError("missing-endpoint")
                http_client = await stack.enter_async_context(httpx2.AsyncClient(trust_env=False))
                transport = streamable_http_client(endpoint, http_client=http_client)
            else:
                raise FixtureError("unsupported-transport")
            mode = "auto" if protocol_era == "modern" else "legacy"
            async with Client(transport, mode=mode, read_timeout_seconds=10) as client:
                negotiated_revision = client.protocol_version
                if (protocol_era == "modern") != (negotiated_revision == "2026-07-28"):
                    raise FixtureError("protocol-era-mismatch")
                operations = ["server/discover" if protocol_era == "modern" else "initialize"]
                if protocol_era == "legacy":
                    await client.session.send_ping()
                    operations.append("ping")
                tools = await client.list_tools(cache_mode="reload")
                selected_tool_name = TOOL_NAME
                if aggregated:
                    selected_tool_name = next(
                        (
                            tool.name
                            for tool in tools.tools
                            if tool.name == TOOL_NAME or tool.name.endswith(f"_1mcp_{TOOL_NAME}")
                        ),
                        "",
                    )
                    if not selected_tool_name:
                        raise FixtureError("aggregated-tool-not-found")
                result = await client.call_tool(selected_tool_name, {"marker": TOOL_INPUT_SENTINEL})
                operations.extend(["tools/list", "tools/call"])
    except FixtureError:
        raise
    except Exception as error:
        raise FixtureError("protocol-probe-failed") from error

    call_error = result.is_error
    output = {
        "callError": call_error,
        **({"classification": "tools-call-failed"} if call_error else {}),
        "fixtureId": FIXTURE_ID,
        "negotiatedRevision": negotiated_revision,
        "ok": not call_error,
        "operations": operations,
        "protocolEra": protocol_era,
        "toolsCount": len(tools.tools),
        "transport": transport_name,
    }
    if not call_error and protocol_era == "legacy":
        output.update({"initialized": True, "ping": True})
    emit(output)


async def legacy_only_http(request, call_next):
    revision = request.headers.get("mcp-protocol-version")
    if revision is None or revision in LEGACY_REVISIONS:
        return await call_next(request)
    try:
        message = await request.json()
    except ValueError:
        message = None
    request_id = message.get("id") if isinstance(message, dict) else None
    return JSONResponse({
        "jsonrpc": "2.0", "id": request_id,
        "error": {"code": -32022, "message": "Unsupported protocol version",
                  "data": {"supported": LEGACY_REVISIONS, "requested": revision}},
    }, status_code=400)


async def serve_streamable_http(protocol_era: str) -> None:
    import uvicorn

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    listener.setblocking(False)
    port = listener.getsockname()[1]
    app = server.streamable_http_app(
        json_response=True,
        stateless_http=protocol_era == "modern",
        host="127.0.0.1",
    )
    if protocol_era == "legacy":
        # Session statefulness alone does not restrict the SDK's modern HTTP entry.
        app.add_middleware(BaseHTTPMiddleware, dispatch=legacy_only_http)
    config = uvicorn.Config(app, log_level="error", lifespan="on")
    http_server = uvicorn.Server(config)
    emit(
        {
            "endpoint": f"http://127.0.0.1:{port}/mcp",
            "fixtureId": FIXTURE_ID,
            "protocolEra": protocol_era,
            "ready": True,
            "transport": "streamable-http",
        }
    )
    await http_server.serve(sockets=[listener])


def parser() -> argparse.ArgumentParser:
    cli = FixtureArgumentParser(add_help=False)
    cli.add_argument("--self-check", action="store_true")
    subcommands = cli.add_subparsers(dest="command", parser_class=FixtureArgumentParser)
    server_command = subcommands.add_parser("server", add_help=False)
    server_command.add_argument("--transport", choices=("stdio", "streamable-http"), default="stdio")
    server_command.add_argument("--protocol-era", choices=("legacy", "modern"))
    probe_command = subcommands.add_parser("probe", add_help=False)
    probe_command.add_argument("--transport", choices=("stdio", "streamable-http"), required=True)
    probe_command.add_argument("--endpoint")
    probe_command.add_argument("--command-json")
    probe_command.add_argument("--protocol-era", choices=("legacy", "modern"), default="legacy")
    probe_command.add_argument("--aggregated", action="store_true")
    return cli


def run(argv: Sequence[str]) -> None:
    arguments = parser().parse_args(argv)
    if arguments.self_check:
        self_check()
    elif arguments.command == "server":
        if arguments.transport == "stdio":
            if arguments.protocol_era is not None:
                raise FixtureError("unsupported-profile")
            server.run("stdio")
        else:
            asyncio.run(serve_streamable_http(arguments.protocol_era or "legacy"))
    elif arguments.command == "probe":
        asyncio.run(
            probe(
                arguments.protocol_era,
                arguments.transport,
                arguments.endpoint,
                arguments.command_json,
                arguments.aggregated,
            )
        )
    else:
        raise FixtureError("usage")


def main() -> None:
    try:
        run(sys.argv[1:])
    except FixtureError as error:
        emit({"errorCode": str(error), "fixtureId": FIXTURE_ID})
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
