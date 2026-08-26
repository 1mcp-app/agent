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


FIXTURE_ID = "python-sdk"
EXPECTED_VERSION = "2.0.0"
TOOL_NAME = "fixture_echo"

server = MCPServer("one-mcp-python-conformance-fixture", version="1", log_level="ERROR")


@server.tool(name=TOOL_NAME, structured_output=True)
def fixture_echo(marker: str) -> dict[str, str]:
    """Return a synthetic receipt."""
    del marker
    return {"receipt": "synthetic-private-result"}


def emit(value: dict[str, object]) -> None:
    print(json.dumps(value, sort_keys=True, separators=(",", ":")), flush=True)


def self_check() -> None:
    version = importlib.metadata.version("mcp")
    if version != EXPECTED_VERSION:
        raise FixtureError("sdk-version-mismatch")
    emit(
        {
            "fixtureId": FIXTURE_ID,
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


async def probe(transport_name: str, endpoint: str | None, command_json: str | None) -> None:
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
            async with Client(transport, mode="legacy", read_timeout_seconds=10) as client:
                await client.session.send_ping()
                tools = await client.list_tools(cache_mode="reload")
                result = await client.call_tool(TOOL_NAME, {"marker": "synthetic-private-argument"})
                negotiated_revision = client.protocol_version
    except FixtureError:
        raise
    except Exception as error:
        raise FixtureError("protocol-probe-failed") from error

    emit(
        {
            "callError": result.is_error,
            "fixtureId": FIXTURE_ID,
            "initialized": True,
            "negotiatedRevision": negotiated_revision,
            "operations": ["initialize", "ping", "tools/list", "tools/call"],
            "ping": True,
            "toolsCount": len(tools.tools),
            "transport": transport_name,
        }
    )


async def serve_streamable_http() -> None:
    import uvicorn

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    listener.setblocking(False)
    port = listener.getsockname()[1]
    app = server.streamable_http_app(json_response=True, stateless_http=False, host="127.0.0.1")
    config = uvicorn.Config(app, log_level="error", lifespan="on")
    http_server = uvicorn.Server(config)
    emit(
        {
            "endpoint": f"http://127.0.0.1:{port}/mcp",
            "fixtureId": FIXTURE_ID,
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
    probe_command = subcommands.add_parser("probe", add_help=False)
    probe_command.add_argument("--transport", choices=("stdio", "streamable-http"), required=True)
    probe_command.add_argument("--endpoint")
    probe_command.add_argument("--command-json")
    return cli


def run(argv: Sequence[str]) -> None:
    arguments = parser().parse_args(argv)
    if arguments.self_check:
        self_check()
    elif arguments.command == "server":
        if arguments.transport == "stdio":
            server.run("stdio")
        else:
            asyncio.run(serve_streamable_http())
    elif arguments.command == "probe":
        asyncio.run(probe(arguments.transport, arguments.endpoint, arguments.command_json))
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
