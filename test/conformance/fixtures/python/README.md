# Python MCP peer fixture

This repository-owned peer uses `mcp==2.0.0` as both an MCP client and server. `uv.lock` is frozen to canonical `https://pypi.org/simple` artifacts with SHA-256 hashes.

Commands:

```bash
uv run --frozen --no-dev python driver.py --self-check
uv run --frozen --no-dev python driver.py server --transport stdio
uv run --frozen --no-dev python driver.py server --transport streamable-http
uv run --frozen --no-dev python driver.py probe --transport stdio --command-json '["python","driver.py","server","--transport","stdio"]'
uv run --frozen --no-dev python driver.py probe --transport streamable-http --endpoint http://127.0.0.1:PORT/mcp
```

The HTTP server always binds `127.0.0.1:0`, emits one readiness record, and shuts down on `SIGTERM`. The stdio client owns and closes its child process through the SDK transport. Loopback HTTP explicitly ignores ambient proxy settings. Probe output contains fixed operation names, booleans, counts, and the negotiated revision; it never contains tool arguments or results.

This driver does not claim the retained HTTP+SSE profile or protocol revision `2024-10-07`. The pinned SDK supports stdio and Streamable HTTP and negotiates the initialize-era revision `2025-11-25` in this probe profile. These gaps are explicit rather than simulated.
