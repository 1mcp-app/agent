# End-to-End Testing

The E2E suite verifies built 1MCP behavior across process, protocol, HTTP, and browser boundaries. Tests in this directory must cross at least one production boundary that a unit or component test cannot cover efficiently.

## Test Lanes

| Lane            | Boundary                                                        | Command                     |
| --------------- | --------------------------------------------------------------- | --------------------------- |
| Non-browser E2E | Built CLI/server, subprocess, filesystem, MCP, or loopback HTTP | `pnpm test:e2e:non-browser` |
| Shardable E2E   | Non-browser tests except the background-runtime lifecycle       | `pnpm test:e2e:shardable`   |
| System E2E      | Background supervisor and runtime lifecycle                     | `pnpm test:e2e:system`      |
| Browser E2E     | Packaged Admin SPA or OAuth consent in Chromium                 | `pnpm test:e2e:browser`     |
| Full E2E        | Browser and non-browser lanes                                   | `pnpm test:e2e`             |

Browser files use the `*.browser.e2e.test.ts` suffix. CI runs them in the Playwright container, runs the long background-runtime lifecycle in a dedicated system lane, and shards the remaining files separately.

## Running Tests

```bash
# Build the artifact exercised by process tests
pnpm build

# Run all E2E tests
pnpm test:e2e

# Run one file
pnpm test:e2e test/e2e/http/http-mcp.test.ts

# Run one named test
pnpm test:e2e -t "connects with the SDK"

# Watch the suite locally
pnpm test:e2e:watch
```

## Directory Layout

```text
test/e2e/
├── commands/       # Built CLI journeys and command persistence
├── fixtures/       # Controlled MCP servers and process fixtures
├── http/           # Live HTTP, OAuth, and Streamable HTTP boundaries
├── integration/    # Cross-component process and protocol journeys
├── setup/          # Global setup and teardown
├── stdio/          # STDIO transport and lifecycle journeys
└── utils/          # Hermetic process, client, and environment helpers
```

## Fidelity Rules

- Start the built CLI or server when the behavior depends on command parsing, process lifecycle, packaging, or transport wiring.
- Use the MCP SDK client for protocol journeys instead of validating hand-written request objects.
- Use loopback servers, temporary directories, and controlled fixtures. Do not depend on public services or the user's configuration.
- Bind port `0` when possible. When the CLI needs a concrete port, allocate a loopback port and wait for a health or protocol-ready signal.
- Assert exact exit codes, protocol results, persisted state, request counts, and recovery output.
- Keep test and harness timeouts as hang guards with diagnostic errors. Do not use elapsed wall-clock thresholds as functional assertions.
- Put schema, formatting, validation matrices, fabricated metrics, and time arithmetic in unit or component tests, not E2E.
- Keep one representative error path per critical journey instead of repeating every option combination through a process.

## Core Journeys

The presubmit suite should retain exact coverage for these paths:

- STDIO aggregation and namespaced capability invocation.
- Streamable HTTP SDK initialization, capability listing/invocation, and session behavior.
- `instructions -> inspect -> run -> wait` against a live 1MCP process.
- Packaged Admin Console operations in Chromium.
- Downstream crash, reload, OAuth, and cleanup behavior.
- CLI configuration mutation with final persisted-state verification.

## Fixtures And Helpers

- `CommandTestEnvironment` creates isolated configuration, application, log, and mock-registry state under `build/.tmp/e2e`.
- `TestProcessManager` owns child processes and cleanup.
- `McpTestClient` drives STDIO, SSE, and Streamable HTTP through the official MCP SDK.
- `echo-server.js`, `error-server.js`, `slow-server.js`, and related fixtures provide deterministic downstream behavior.

Always close clients, browsers, HTTP servers, and subprocesses in teardown. A retry is diagnostic protection, not evidence that a flaky test is acceptable.
