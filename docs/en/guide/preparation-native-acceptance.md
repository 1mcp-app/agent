---
title: Native graph preparation acceptance
description: Reproduce native graph ownership and freshness diagnostics without claiming automatic preparation support.
---

# Native graph preparation acceptance

Use this page to reproduce the native safety investigation for CodeGraph and Code Review Graph. These diagnostics are **not preparation integrations**. They do not enable setup entries, establish readiness, or install dependencies. See [Backend preparation](/guide/backend-preparation) for the existing configured-command lifecycle.

## Reproduce the investigation

From a source checkout with the backends already installed:

```bash
python3 -B scripts/verify-native-preparation-graphs.py \
  /absolute/path/to/codegraph-platform-bundle \
  /absolute/path/to/crg-virtualenv/bin/python
```

The CodeGraph platform bundle must contain `node`, `package.json`, and `lib/dist`. Pass the Code Review Graph virtualenv's interpreter path; resolving its interpreter symlink can lose the virtualenv's installed packages. The diagnostic uses the supplied installations directly. It does not run `npx`, `uvx`, or a dependency installer.

The script creates new main, linked-worktree, and independent fixture repositories **only under `/private/tmp/1mcp-651`**. It indexes those fixtures with native commands and reads the installed native source. It does not open or synchronize the live repository's indexes. It disables fixture Git hooks and CodeGraph downloads, telemetry, and daemon startup. Retained `graphs-native-*/evidence.json` files contain commands, outcomes, source paths, source hashes, source excerpts, timing, and fixture identity. The latest completed report is `/private/tmp/1mcp-651/graphs-native-evidence.json`.

Exit zero means the diagnostic reproduced its assertions about the tested native behavior. It does **not** mean automatic preparation passed acceptance. A changed native implementation may cause an assertion failure; inspect the recorded outcome before changing the diagnostic.

## Verified scope

The 2026-10-14 investigation used installed CodeGraph **1.6.2** and Code Review Graph **2.3.9** on **macOS arm64**. Native queries returned each checkout's unique Python symbol and excluded the other checkout's symbol for main, linked, and independent repositories. Each initially contained one supported Python file, approximately 39–53 bytes. This establishes checkout isolation for those fixtures, not universal language or platform coverage.

One recorded run measured:

| Operation                              |   Main | Linked | Independent |
| -------------------------------------- | -----: | -----: | ----------: |
| CodeGraph native initialization        | 488 ms | 528 ms |      516 ms |
| CRG native build                       | 269 ms | 269 ms |      228 ms |
| CodeGraph native read-only state/query | 148 ms | 144 ms |      140 ms |
| CRG native status                      | 202 ms | 204 ms |      207 ms |
| CodeGraph native source scan           | 213 ms | 216 ms |      235 ms |

These are tiny local fixtures. They do not establish large-repository performance, unrelated-tool responsiveness, production scheduling, or cancellation of runtime preparation jobs.

## Native ownership blockers

**CodeGraph CLI initialization writes before ownership admission.** A separate living process acquired the backend's actual exported `FileLock`. Native `init --yes` nevertheless created `codegraph.db`, reported failure to acquire the indexing lock, and exited **0**. The foreign process and lock remained intact. Exit zero alone therefore cannot establish successful initialization.

**CodeGraph CLI synchronization can interfere before failing admission.** A foreign native writer held `FileLock` and called `DatabaseConnection.beginBulkNodeLoad()`, temporarily dropping its FTS trigger. Native `sync` opened the database, healed that bulk-load window, recreated `nodes_ai`, and only then failed to acquire the lock (exit **1**). The foreign holder and PID lock remained intact. This is an observed write into another native writer's active operation, not a fixture-owned integration lock test.

**The native CodeGraph API does not provide a lock handoff to the preparation facade.** Acquiring `FileLock` before `CodeGraph.open()` protects that caller's open, but both `sync()` and `indexAll()` attempt to acquire it again. Even the same PID is rejected. `sync()` throws; `indexAll()` returns `success: false`. There is no facade option to inject an acquired lock or index under existing ownership. Patching private lock methods is not a supported solution. Also, an external wrapper lock would not stop native initialization's observed writes before its own lock acquisition.

**CRG's native operations do not retain an enclosing SQLite ownership transaction.** `GraphStore` opens writable state and runs schema initialization/migrations in its constructor, with no read-only or existing-connection constructor argument. `set_metadata()` commits the connection. `store_file_nodes_edges()` rolls back any existing transaction before starting and committing its own. The API experiment found that metadata writing released the outer transaction; an uncommitted marker was rolled back by native file writing; and a second SQLite writer could then acquire ownership. The experiment accesses the connection only to test the proposed enclosing transaction; it is not a supported production API or a monkeypatch.

SQLite provides native contention protection for individual CRG transactions. These findings do not claim SQLite has no locking. They show why placing one ownership transaction around the native build/update API does not preserve ownership across the operation. A separate locked SQLite connection would block the native connection's own writes. An integration-only lock would not coordinate native watchers and CLI writers.

The diagnostic sends `SIGTERM` only to lock-holder processes it started; those holders release their own native locks. It neither repairs nor removes foreign locks. This verifies diagnostic-process cleanup, **not** the requested runtime job-cancellation gate.

## Freshness and read-only boundaries

After initialization, the diagnostic adds an uncommitted supported Python file outside the old example manifest. CodeGraph still reports `index_state: complete` and `isIndexStale(): false`, while native queries lack the new symbol. `isIndexStale()` checks extraction-version compatibility, not source freshness. CRG reports matching stored/current Git commits and `build_incomplete: false` while also lacking the new symbol. Neither bounded status result proves source freshness.

CodeGraph's native `getChangedFiles()` does detect the additional file on a read-only instance. A full supported-source scan is therefore a possible freshness seam; its necessity and scaling must be measured, rather than treating cheap status as equivalent. The native read-only open also changed SQLite WAL/SHM sidecars in these fixtures; the diagnostic records the affected filenames. CRG status left index bytes unchanged in this tested state, but its `GraphStore` construction remains a writable schema/migration path for other states. Neither observation establishes a universally read-only warm probe.

Relevant installed-source evidence is recorded with whole-file SHA-256 and line excerpts:

| Backend   | Source                             | Relevant lines in tested installation                                                                                            |
| --------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CodeGraph | `lib/dist/index.js`                | 282–300: initialization; 446–453: indexing lock; 762–769: synchronization lock; 1270–1275: extraction freshness                  |
| CodeGraph | `lib/dist/utils.js`                | 269–335: native `FileLock` admission and owned release                                                                           |
| CodeGraph | `lib/dist/db/index.js`             | 187–218: writable open, migrations, bulk-load healing                                                                            |
| CodeGraph | `lib/dist/bin/codegraph.js`        | 633–705: native initialization; 927–945: open before sync                                                                        |
| CRG       | `code_review_graph/graph.py`       | 701–722: constructor; 978–1013: transaction replacement and file commits; 1102–1110: metadata commit; 1143–1148: commit/rollback |
| CRG       | `code_review_graph/incremental.py` | 1744–1781: build API; 1833–1846 and 2136–2146: freshness writes and commits                                                      |

## Remaining acceptance gates

Neither tested backend has verified automatic preparation support from this investigation. Safe write admission before every native write, native writer coordination across a full operation, strict read-only warm probing, contained preparation cancellation, and complete supported-source freshness remain unresolved. No setup-only catalog entry or helper that always returns unsupported is delivered as a substitute.

A viable follow-up needs native lock acquisition before database initialization/open/healing and an explicit acquired-ownership API for CodeGraph. CRG needs native operation ownership that covers constructor/schema changes, file batches, metadata, and post-processing without replacing the owner's transaction, plus a genuinely read-only inspection interface. Such changes require native backend work or separately proven native interfaces; this diagnostic does not patch installed backends or declare the feature complete.
