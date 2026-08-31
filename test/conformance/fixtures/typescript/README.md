# TypeScript MCP peer fixtures

This fixture-local package owns real MCP peers for the pinned TypeScript SDK eras. Install it independently from the repository workspace:

```bash
pnpm install --ignore-workspace --frozen-lockfile
pnpm self-check
pnpm check
```

`--self-check` reads each installed package's metadata and dynamically imports every required public SDK export. It exits nonzero if a version or export differs from the fixture contract.

## Profiles

| SDK era | Packages                                     | Transports                        | Protocol era                          |
| ------- | -------------------------------------------- | --------------------------------- | ------------------------------------- |
| `v1`    | `@modelcontextprotocol/sdk@1.30.0`           | `stdio`, `streamable-http`, `sse` | legacy revisions through `2025-11-25` |
| `v2`    | split client/server/node packages at `2.0.0` | `stdio`, `streamable-http`        | legacy or `2026-07-28`                |
| `v2`    | `@modelcontextprotocol/server-legacy@2.0.0`  | `sse`                             | retained legacy only                  |

HTTP servers bind `127.0.0.1` on port `0`. Their only startup line is structural JSON containing `kind`, SDK era, transport, loopback host, and assigned port. `SIGINT` and `SIGTERM` close active MCP transports and the HTTP listener.

```bash
node src/fixture.mjs server --sdk-era v2 --transport streamable-http
node src/fixture.mjs server --sdk-era v1 --transport stdio
```

Probe mode owns its client transport and teardown. For stdio, repeat `--arg`; child arguments beginning with `--` use `--arg=--flag`.

```bash
node src/fixture.mjs probe \
  --sdk-era v2 \
  --protocol-era modern \
  --transport streamable-http \
  --endpoint http://127.0.0.1:3000/mcp

node src/fixture.mjs probe \
  --sdk-era v1 \
  --protocol-era legacy \
  --transport stdio \
  --command node \
  --arg src/fixture.mjs \
  --arg server \
  --arg=--sdk-era \
  --arg v1 \
  --arg=--transport \
  --arg stdio
```

Probe output contains only operation booleans, tool counts/names-presence, and result content types/error state. It never emits the endpoint, command, arguments, raw MCP results, environment values, or filesystem paths.

## Official client contract

The fixture also accepts the official conformance startup form:

```text
node src/fixture.mjs <server-url>
```

It reads `MCP_CONFORMANCE_SCENARIO`, `MCP_CONFORMANCE_CONTEXT`, and `MCP_CONFORMANCE_PROTOCOL_VERSION` without emitting their values. Supported scenario families are `initialize`, `tools`, `elicitation`, `sse-retry`, `custom-headers`, `invalid-headers`, `standard-headers`, `request-state`, and `schema`. An unsupported scenario or protocol profile exits `2` with a fixed structural classification. HTTP endpoints must resolve literally to `127.0.0.1`, `::1`, or `localhost` over plain HTTP.

## Modern protocol limitation

The pinned v2 client uses `server/discover`, not `initialize`, for the `2026-07-28` lifecycle. Its public `ping()` method rejects modern calls with `METHOD_NOT_SUPPORTED_BY_PROTOCOL_VERSION` because `ping` is not in that wire era. A modern probe therefore performs real discovery, `tools/list`, and `tools/call`, but returns `ok: false` with explicit `unsupported-operation` entries for `initialize` and `ping`; it does not simulate either operation.

The pinned v1 client hard-codes `2025-11-25` as its initial proposal. `MCP_CONFORMANCE_PROTOCOL_VERSION` selects modern versus legacy fixture behavior, but cannot force v1's public client to propose an older retained revision. The official runner permits hard-coded SDK clients to ignore that value; older revisions require server-side negotiation or a different peer.
