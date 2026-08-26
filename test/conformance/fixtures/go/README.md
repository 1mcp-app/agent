# Go MCP peer fixture

This repository-owned peer uses `github.com/modelcontextprotocol/go-sdk@v1.7.0` as both an MCP client and server. `go.sum` records the module checksums and `vendor/` makes the conformance lane independent of the network and mutable module proxies.

Commands:

```bash
go run -mod=vendor . --self-check
go run -mod=vendor . server --transport stdio --protocol-era legacy
go run -mod=vendor . server --transport streamable-http --protocol-era modern
go run -mod=vendor . probe --transport stdio --protocol-era legacy --command-json '["/absolute/fixture","server","--transport","stdio","--protocol-era","legacy"]'
go run -mod=vendor . probe --transport streamable-http --protocol-era modern --endpoint http://127.0.0.1:PORT/mcp
```

The HTTP server always binds `127.0.0.1:0`, emits one readiness record, and shuts down on `SIGTERM`. Modern HTTP is stateless; legacy HTTP retains an initialized transport session. The stdio client owns and closes its child process through the SDK transport. Probe output contains fixed operation names, removed-operation facts, booleans, counts, and the observed negotiated revision; it never contains tool arguments or results.

This driver does not claim the retained HTTP+SSE profile or protocol revision `2024-10-07`. In legacy mode its repository-owned server returns the standard method-not-found response to `server/discover`, causing the pinned SDK client to exercise its real `initialize` fallback and negotiate `2025-11-25`. Modern mode performs real `server/discover`, negotiates `2026-07-28`, and uses SDK-generated per-request metadata for tools/list and tools/call.

Go SDK `v1.7.0` does not prevent `ClientSession.Ping` on `2026-07-28`; against its stdio server the removed method returns success. The modern probe therefore does not send ping and reports `{operation: "ping", reason: "not-in-2026-07-28"}` alongside the removed initialize lifecycle. It does not treat accepted legacy-shaped ping traffic as modern evidence.
