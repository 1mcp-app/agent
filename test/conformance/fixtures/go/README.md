# Go MCP peer fixture

This repository-owned peer uses `github.com/modelcontextprotocol/go-sdk@v1.7.0` as both an MCP client and server. `go.sum` records the module checksums and `vendor/` makes the conformance lane independent of the network and mutable module proxies.

Commands:

```bash
go run -mod=vendor . --self-check
go run -mod=vendor . server --transport stdio
go run -mod=vendor . server --transport streamable-http
go run -mod=vendor . probe --transport stdio --command-json '["/absolute/fixture","server","--transport","stdio"]'
go run -mod=vendor . probe --transport streamable-http --endpoint http://127.0.0.1:PORT/mcp
```

The HTTP server always binds `127.0.0.1:0`, emits one readiness record, and shuts down on `SIGTERM`. The stdio client owns and closes its child process through the SDK transport. Probe output contains fixed operation names, booleans, counts, and the negotiated revision; it never contains tool arguments or results.

This driver does not claim the retained HTTP+SSE profile or protocol revision `2024-10-07`. Its repository-owned server intentionally returns the standard method-not-found response to `server/discover`, causing the pinned SDK client to exercise its real `initialize` fallback and negotiate `2025-11-25` on both transports. The unsupported gaps are explicit rather than simulated.
