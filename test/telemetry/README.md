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
  preserves that suite's exact propagation assertions.
- `active-interactions`: separate active tracing across all four era cells with
  actual OTLP payloads, reverse/resume ancestry, HTTP context links, carrier
  privacy and request spans ending before native continuation is sent.
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

Preparation generates runtime launch configurations. Before each runtime starts,
measurement launches the modern HTTP echo/error backend in its own child process,
validates its owned readiness IPC, and writes its OS-assigned loopback URL into an
owned mode configuration. All four modes use the same pinned `2026-07-28` upstream
protocol and legacy HTTP benchmark client. The legacy upstream connection
intentionally admits one operation; it cannot serve the parallel workload of 16.
Backend startup is bounded at 10s and cleanup at 3s plus a 3s forced-exit fallback.
Backend and runtime stderr files are retained beside the measurement report.
Preparation copies the current build and transforms only the propagation adapter
in a test-only baseline. Carrier removal, baggage sanitation and business handlers
remain identical. The manifest lists exact replacements and original/transformed
SHA256 hashes. All other build files are copied unchanged. Never publish this
baseline. Rerun preparation after any source/build change.

Measurement requires a clean matching source commit. Every mode uses the same
preload probe in the actual foreground runtime for RSS and event-loop delay. The
healthy/outage comparison uses a loopback fake Collector (valid empty protobuf
responses / HTTP 503), distinct from real Collector integration. All four modes
use the recorded `settleMs: 65000` after the same warmup, matching process age,
background JIT and timer activity before measurement. Each measurement performs at least 10,000 operations and
lasts at least 60 seconds. Mode order rotates over at least three paired rounds.
Run on an otherwise idle host after broad tests stop. This takes at least 25 minutes
for three rounds, plus startup and warmup; increase repetitions when intervals remain inconclusive.

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
export attempt, so pre-provider fast exits cannot pass vacuously. The supervised
stop driver allows the existing 30-second owner deadline plus bounded CLI
overhead. Its Collector-visible export interval measures receipt through socket
closure and excludes work before the first payload arrives; complete telemetry
shutdown budgets are verified separately through the SDK facade deadline tests. Set
`ONE_MCP_TEST_BINARY` to the built native SEA executable to run the same
shutdown assertions against that binary; Node results do not prove SEA coverage.

The performance and capacity plans record this topology before samples. Capacity
uses the same owned modern HTTP backend with all 10,000 private tool identities,
served in standard 1,000-item catalog pages, while retaining concurrency 32 and the
original pressure settings. The backend is outside the benchmark client event loop.
Legacy functional and active interaction tests retain their separate fixtures.

A functional-only smoke (no accepted timing/RSS samples) checks exact 1,000 mixed
operations at concurrency 16 for baseline and propagation, then the 10k inventory,
first/last tools and 32 concurrent calls:

```sh
node scripts/telemetry/smoke-modern-backend.mjs /tmp/telemetry-smoke /absolute/path/to/baseline-build/index.js
```

Failed preparations/reports remain evidence. After any harness/source commit,
prepare a new unique performance directory before measuring; do not reuse stale
baseline manifests or incomplete reports as samples.

After the final integration build is clean and the host is otherwise idle:

```sh
OTELCOL_BINARY=/absolute/path/to/otelcol node scripts/telemetry/capacity.mjs /tmp/telemetry-capacity.json
```

Plan v3 predeclares two complementary risks before new samples:

- **A — identity privacy and SDK cardinality:** `real-capacity.integration.test.mjs`
  attempts 10,000 distinct forbidden identities per instrument, split between
  unknown keys and forbidden values in recognized dimensions. Every attempt must
  return false. Accepted controls must export through the actual SDK and pinned
  Collector; decoded cumulative counts and series must contain only the 1,188
  accepted combinations across at least two collection intervals. Positive
  approved combinations must reach the histogram/counter/up-down caps of
  1,024/512/256 with standard overflow. Empty exports cannot pass.
- **B — sustained runtime resources:** `capacity-workload.json` uses one fixed
  capacity tool plus three functional tools. Two independently initialized legacy
  HTTP owners each run 16 workers (32 aggregate), respecting existing owner and
  route admission. All 10,000 warmup operations, 8,192-span queue/2,048 batch,
  30-second stalled export, six 10-second windows and minimum 2,048 operations per
  window remain unchanged. Final three windows must actually observe high queue
  and drops. Readiness/results, 64 MiB RSS envelope, 16 MiB final-three-window
  plateau spread, 40-second recovery and decoded export checks remain mandatory.

The former 10,000-configured-tool catalog workload failed during warmup with
schema evaluation timeouts; its single-owner variant also exceeded admission.
Those adverse reports remain evidence, and **10k catalog scalability remains an
explicit coverage gap**. Rejecting 10,000 identity values is not evidence that
10,000 configured tools can sustain this request rate. Plan v3 isolates the
telemetry risks without changing their budgets or the matched timing workload.

The capacity harness persists partial results and cleanup verdicts on failure.
Its relay forwards only synthetic OTLP protobuf to the pinned loopback Collector
and never forwards secret request headers. Source changes require new recorded
acceptance runs. The bounded `capacity-owners.test.mjs` smoke proves one owner
rejects its 17th held call while two owners admit all 32; it is not an RSS proof.
