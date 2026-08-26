# Python MCP peer fixture

This repository-owned peer uses `mcp==2.0.0` as both an MCP client and server. `uv.lock` is frozen to canonical `https://pypi.org/simple` artifacts with SHA-256 hashes.

Commands:

```bash
uv run --frozen --no-dev python driver.py --self-check
uv run --frozen --no-dev python driver.py server --transport stdio --protocol-era legacy
uv run --frozen --no-dev python driver.py server --transport streamable-http --protocol-era modern
uv run --frozen --no-dev python driver.py probe --transport stdio --protocol-era legacy --command-json '["python","driver.py","server","--transport","stdio","--protocol-era","legacy"]'
uv run --frozen --no-dev python driver.py probe --transport streamable-http --protocol-era modern --endpoint http://127.0.0.1:PORT/mcp
```

The HTTP server always binds `127.0.0.1:0`, emits one readiness record, and shuts down on `SIGTERM`. Modern HTTP is stateless; legacy HTTP retains an initialized transport session. The stdio client owns and closes its child process through the SDK transport. Loopback HTTP explicitly ignores ambient proxy settings. Probe output contains fixed operation names, removed-operation facts, booleans, counts, and the observed negotiated revision; it never contains tool arguments or results.

This driver does not claim the retained HTTP+SSE profile or protocol revision `2024-10-07`. Legacy mode performs initialize and negotiates `2025-11-25`. Modern mode performs real `server/discover`, negotiates `2026-07-28`, and uses SDK-generated per-request metadata for tools/list and tools/call. The pinned client rejects modern ping with MCP error code `-32601`; the probe records initialize and ping as removed instead of simulating them.
