# Protocol regression testing

From the repository root, install the independent peer fixtures, then run the suite:

```bash
pnpm install --frozen-lockfile
pnpm --dir test/conformance/fixtures/typescript install --frozen-lockfile
uv sync --frozen --project test/conformance/fixtures/python
pnpm test:protocol
```

Use the repository Node/pnpm versions and Python 3.13 with uv. The command builds once, checks both peer fixtures, and runs protocol tests without retries. Tests own temporary configurations and subprocesses; they do not require a clean worktree or generate a release baseline. The historical `test/conformance` directory name remains to avoid unrelated file moves.

`pnpm check` remains the static, source/Admin unit, release, and permission gate. Protocol tests run separately in the blocking `test-protocol` CI job, included in both `ci` and release aggregation. The static job no longer installs Python or independent peer fixtures or runs migration harness tests. CI retains the same job count: one protocol job replaces one conformance job; the reduction is in steps, duplicate setup, and migration work.

## Retained coverage

| Previous tests or machinery                                                                     | Current disposition                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport profile tests                                                                         | All six gateway journeys retained: inbound HTTP/SSE, direct stdio, proxy stdio, upstream SSE, modern upstream stdio, legacy upstream stdio. Artifact serialization removed.                                                   |
| Foundation matrix                                                                               | Twelve modern/legacy combinations with TypeScript and alternate Python inbound/upstream peers are ordinary blocking assertions.                                                                                               |
| Retained revision probes                                                                        | Negotiation assertions retained without evidence files.                                                                                                                                                                       |
| Request-state integration                                                                       | Real authenticated gateway and owned peer check continuations, changed request IDs, interleaved isolation, absent state, and credential isolation. Historical expected SDK rejection removed.                                 |
| Initial inputs, MRTR isolation, catalog notifications                                           | Existing direct gateway tests retained. Selected official-toolkit scenarios remain test drivers, not release conformance verdicts.                                                                                            |
| SDK boundary proof                                                                              | Existing source tests retain JSON/schema rejection, detached values, converted SDK errors, and adapter behavior. Import-boundary and packaged-transport tests remain required. Only snapshot/verdict/artifact checks removed. |
| Fixture tests, capture safety, runtime cleanup, canonical target, reference peer, client bridge | Retained where needed by the protocol suite, including sanitization and owned-process cleanup. Duplicate scenario-inventory equality removed.                                                                                 |
| Baseline and traceability tests                                                                 | Deleted: tested migration verdict aggregation and requirement-to-artifact bookkeeping.                                                                                                                                        |
| Integrity tests                                                                                 | Deleted: tested source/fixture inventory, snapshot and evidence identity for the retired release baseline. Frozen package-manager lockfiles and patched-source checks remain.                                                 |
| Foundation runner tests                                                                         | Deleted migration orchestration/classification assertions; product matrix and negotiation checks extracted above.                                                                                                             |
| Official runner, client/server controls, toolkit repair tests                                   | Deleted official-suite classification, comparison, and toolkit-copy repair machinery. Direct product tests and their required reference fixture remain.                                                                       |
| Preparation runner tests                                                                        | Deleted parallel migration preparation scheduler; protocol command executes build and fixture checks sequentially and propagates failures.                                                                                    |
| Release conformance validator                                                                   | Replaced by versioned release-check validation; old release records still require their original green conformance verdicts.                                                                                                  |

## Dependency and release policy

Manifests and frozen lockfiles determine current peer versions. The build verifies the legacy SDK patch, retained source hashes, imports, and license provenance; routine Zod or adapter changes do not require a historical topology snapshot update. Missing exports, inconsistent installations, and changed patched sources still fail.

New `release-gates.json` records use `schemaVersion: 1`, `sha`, `ci`, and `checks`. Required checks must all succeed for the selected candidate. Recovery rejects unknown schemas, wrong source revisions, missing checks, and failed/cancelled/skipped results. Unversioned historical records keep their original conformance policy. Neither format proves publication or deployment.
