# Real backend acceptance examples

These external scripts exercise installed CodeGraph and Code Review Graph through
the same runtime-authorized configured-command adapter. Backend names, status
formats and native CLI arguments belong here, outside runtime core.

After building 1MCP, run:

```sh
node scripts/verify-configured-preparation.mjs \
  /absolute/path/to/codegraph \
  /absolute/path/to/code-review-graph \
  /absolute/path/to/report-directory
```

The script creates disposable repositories and a real linked worktree under the
report directory. It preserves them for inspection and writes
`configured-preparation-report.json`, recording backend versions, platform,
source size, cold admission/preparation, shared jobs and warm probe timings.
It does not install dependencies, download backends, install hooks, enable paid
services, rebuild existing indexes or repair foreign locks. Run it only against
already installed CLIs. Successful fixture timings do not establish production
repository performance.

`native-fixture-command.mjs` accepts backend, absolute executable, action and
checkout as separate arguments. The configured command runs Node with an argv
array; paths containing spaces or shell metacharacters stay literal. Configure
`probe` with action `probe`, and `initialize`/`sync` with those actions. Use
`containment: "posix-process-group"`; descendants must not detach. The example
disables CodeGraph daemons and network fallback. Windows containment is outside
this example's verified coverage.

Probe exits are explicit: `0` ready, `10` initialize, `11` sync, `12` conflicting
writer, and unmapped `13` unknown. An unknown receipt requires inspection or an
explicit operator action; it does not silently trigger a rebuild. Every action
performs one native operation, validates native status and checkout-specific
symbol results, then saves a source fingerprint. The runtime must probe again.
Preparation never runs or replays a requested source operation.

Freshness coverage is deliberately narrow: `.preparation-example/sources.json`
lists at most 64 source files, each at most 64 KiB, with the exact symbol expected
from that checkout. Warm probes read those entries and bounded native symbol
queries. CodeGraph's CLI status can scan source, so this external example uses
the installed SDK's explicit `readOnly` mode for metadata and symbol queries,
with the installed bundle's Node runtime. The helper supports the installed
npm/standalone bundle layout verified with CodeGraph 1.6.2. Code Review Graph's
CLI status reads stored graph metadata (verified with 2.3.9).
The wrapper never walks the repository on warm calls. Changing a listed source produces `sync` even when main and
linked worktrees share Git HEAD. Files outside that explicit operation manifest
have **unknown coverage**. This receipt is not a general repository freshness
proof, and Git HEAD or index existence alone is never treated as readiness.

All example writers must use the exclusive `.preparation-example/writer` lock.
Concurrent example runtimes see conflict; crashes retain that conflict until an
operator verifies ownership. The CodeGraph native writer marker also causes
conflict and is never removed. Code Review Graph's status does not prove native
foreign writer ownership: acceptance runs in isolated disposable fixtures, and
direct native writers outside this wrapper are a coverage gap. Do not promote
this example to production without a backend-supported ownership contract.

The report distinguishes adapter/service acceptance from HTTP discovery refresh,
supported client hook delivery, native long-running cancellation and large
repository measurements. Those remain separate verification gates.
