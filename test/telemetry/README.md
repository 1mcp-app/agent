# Operational Telemetry acceptance

These tests observe approved public seams: actual OTLP wire payloads, real runtime
CLI/endpoints and SDK transports, configuration, lifecycle and read-only status.
They do not mock providers or call SDK implementation internals.

## Run

Install the repository dependencies in this checkout and build the runtime first.
The host needs Node supported by the repository and `openssl` for ephemeral TLS
identities. No production Collector or credentials are used.

```sh
pnpm build
node --test test/telemetry/collector.test.mjs test/telemetry/real-collector.test.mjs
OTELCOL_BINARY=/absolute/path/to/otelcol pnpm exec vitest run --config test/telemetry/vitest.config.ts
```

`OTELCOL_BINARY` must be an official checksum-verified **0.163.1** executable. Obtain
the matching platform archive and `.sha256` from the official
[Collector releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases/tag/v0.163.1).
The host verifies the version, starts a loopback receiver, tests its protobuf
response, and captures decoded OTLP JSON in a disposable directory. The standalone
real-Collector infrastructure test skips without this variable; the real export
integration also skips. CI must supply it; skips do not prove real export.
The optional Docker fixture is `compose.yaml`; set `TELEMETRY_CAPTURE_DIR` to an
empty writable directory before `docker compose -f test/telemetry/compose.yaml up`.
Docker is not required when using the executable.

Runtime tests use loopback ports 14320 and 14322 sequentially; real Collectors and new lifecycle/status runtime hosts allocate their own loopback ports. Keep these free and do
not run multiple copies concurrently. Collectors and backends otherwise use
operating-system allocated ports. The fake Collector captures decompressed wire
bytes with bounded retention, supports delayed/503 responses, and never writes
request headers into artifacts.

## What the suites establish

- `runtime`: four real CLI inbound/upstream era cells, returned data privacy,
  unchanged results/readiness during Collector outage, orderly shutdown. Legacy
  inbound includes real reverse roots requests.
- `interactions`: reuse the established authenticated four-era interaction and
  continuation/ownership suite while exporting metrics. Metrics-only deliberately
  preserves that suite's exact propagation assertions. This does not prove active
  tracing topology on reverse/resumed requests.
- `transports`: real stdio/SSE and stdio-to-HTTP proxy transport replies, including a
  delayed response which must keep its request span open. Proxy tests launch the actual CLI from an isolated cwd, preserving CLI attachment and lifecycle coverage.
- `payload`, `real-export`: public operation facade plus actual protobuf exports;
  real Collector decodes traces and metrics. These are not transport tests.
- `tls`: actual HTTPS/mTLS exports with an ephemeral test CA, never global trust.
- `capacity`: real queue overflow, bounded warning/recovery/idle state and actual
  SDK overflow-series export. These checks are not a sustained RSS capacity run.

The privacy corpus uses synthetic markers. Its scan rejects vacuous no-export
success and checks decompressed protobuf bytes and decoded Collector payloads.
Coverage is only established for markers actually injected by each test; this is
not proof that every forbidden input category or local diagnostic path was hit.

## Matched performance

The workload and budgets are recorded in `scripts/telemetry/workload.json` before
execution. After building the final source commit:

```sh
node scripts/telemetry/prepare-performance.mjs /tmp/telemetry-perf-unique 3
node scripts/telemetry/measure.mjs /tmp/telemetry-perf-unique/run.json /tmp/telemetry-perf-unique/report.json
```

Preparation generates complete runtime configurations and the real echo/error
backend. It copies the current build and transforms only the propagation adapter
in a test-only baseline. Carrier removal, baggage sanitation and business handlers
remain identical. The manifest lists exact replacements and original/transformed
SHA256 hashes. All other build files are copied unchanged. Never publish this
baseline. Rerun preparation after any source/build change.

Measurement requires a clean matching source commit. Every mode uses the same
preload probe in the actual foreground runtime for RSS and event-loop delay. The
healthy/outage comparison uses a loopback fake Collector (valid empty protobuf
responses / HTTP 503), distinct from real Collector integration. Active modes
settle for 65 seconds; each measurement performs at least 10,000 operations and
lasts at least 60 seconds. Mode order rotates over at least three paired rounds.
Run on an otherwise idle host after broad tests stop. This takes about 25 minutes
for three rounds; increase repetitions when intervals remain inconclusive.

The report retains exact source/platform/workload and paired conservative 95%
intervals for p95/throughput ratios, RSS differences, and event-loop p99 differences.
Budget exceedance fails. An interval crossing a budget is **inconclusive**, never a
pass. The harness returns nonzero for either. A successful timing run does not
establish sustained queue/RSS plateau, max-limit capacity, Node/SEA platform
coverage, release, deployment, canary acceptance or customer impact.

## Runtime lifecycle and capacity increment

`runtime-observation.integration.test.mjs` drives actual HTTP/backend debug
diagnostics, independently supplied MCP/HTTP carriers and RPC/Tool outcomes, plus
authenticated Admin health, public readiness and `serve --status`.
`lifecycle.integration.test.mjs` drives repeated shutdown signals and a real Node
uncaught exception through a test-only preload. It requires a positive Collector
flush attempt, so pre-provider fast exits cannot pass vacuously. Set
`ONE_MCP_TEST_BINARY` to the built native SEA executable to run the same
shutdown assertions against that binary; Node results do not prove SEA coverage.

After the final integration build is clean and the host is otherwise idle:

```sh
OTELCOL_BINARY=/absolute/path/to/otelcol node scripts/telemetry/capacity.mjs /tmp/telemetry-capacity.json
```

This separate gate records `capacity-workload.json` before work: 10,000 actual
tool identities, max 8,192-span queue/2,048 batch, stalled 30-second export and six
10-second pressure windows. It checks returned data/readiness, dropped/high queue
state, RSS envelope/plateau, recovery and decoded real-Collector series caps.
It persists partial results on failure. The fault relay forwards only synthetic
OTLP protobuf to the loopback pinned Collector after recovery and never forwards
secret request headers. Run this alongside the matched timing gate only when
explicitly scheduled; source changes require rerunning both gates.
