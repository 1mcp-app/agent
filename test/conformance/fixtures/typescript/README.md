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

## Official OAuth fixture gap

The gateway bridge classifies the pinned suite's `auth/*` client scenarios as `fixture-defect` before starting the gateway or client. Its status reason is `oauth-fixture-context-unavailable`. The official checks remain available, but these scenarios do not establish a gateway OAuth product verdict; required OAuth coverage remains blocked. Sanitized scenario IDs, bridge statuses, and the fixed reason survive temporary-directory cleanup in the digest-protected `official-client-statuses/client.<revision>.json` artifact, which links the retained raw official evidence and records its fixture classification.

`@modelcontextprotocol/conformance@0.2.0-alpha.11` starts its authorization server on an ephemeral port inside the CLI process. It passes the resource URL and optional credentials to the client command, without independently owned authorization-server context. The source's optional `ScenarioUrls.authUrl` field is unused and is not forwarded by the runner. The installed package ships a CLI bundle without an exported scenario lifecycle API or a client option for this context. This fixture also lacks a driver that completes authorization and proves an authenticated tool call.

Advertised protected-resource metadata, callback `iss`, arbitrary extra context fields, and client credentials do not grant trust to another local origin. A qualified OAuth fixture must own the exact issuer before gateway startup, preserve the actual state, code, issuer, and PKCE exchange, and verify the authenticated upstream tool call. Separate owned OAuth tests are additional evidence and do not replace these blocked official scenarios.

## Modern protocol limitation

The pinned v2 client uses `server/discover`, not `initialize`, for the `2026-07-28` lifecycle. Its public `ping()` method rejects modern calls with `METHOD_NOT_SUPPORTED_BY_PROTOCOL_VERSION` because `ping` is not in that wire era. A modern probe therefore performs real discovery, `tools/list`, and `tools/call`, reports `ok: true` only when the tool call succeeds, and omits the inapplicable `initialize`/`ping` fields; it does not simulate either operation.

The pinned v1 client hard-codes `2025-11-25` as its initial proposal. `MCP_CONFORMANCE_PROTOCOL_VERSION` selects modern versus legacy fixture behavior, but cannot force v1's public client to propose an older retained revision. The official runner permits hard-coded SDK clients to ignore that value; older revisions require server-side negotiation or a different peer.
