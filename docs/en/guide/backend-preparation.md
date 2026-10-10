---
title: Checkout-Specific Backend Preparation
description: Enable bounded CodeGraph preparation, inspect readiness, and control runtime-owned indexing jobs for a selected checkout.
---

# Checkout-Specific Backend Preparation

Preparation makes a selected checkout's source index usable before a relevant tool runs. Select the checkout explicitly when working across repositories or worktrees. Another checkout's index, a connected server, or successful tool discovery does not establish source coverage for your target.

## Two Separate Permissions

The runtime operator configures the backend's supported actions. A project's `.1mcprc` opts into automatic preparation for that configured backend name. Project configuration cannot grant an action the runtime forbids.

Add preparation metadata to the existing runtime server definition:

```json
{
  "preparation": {
    "adapter": "codegraph",
    "executable": "/absolute/path/to/already-installed/codegraph",
    "expectedVersion": "1.6.2",
    "sourceMonitor": "git-fsmonitor",
    "allowedActions": ["initialize", "sync"]
  }
}
```

The adapter uses an already-installed, verified backend. It does not download or install CodeGraph. `sourceMonitor` explicitly permits preparation to start a foreground native Git source monitor for the selected checkout. Existing monitors are borrowed; inspection never starts one. The verified native integration is CodeGraph 1.6.2 with Git 2.52 on local macOS checkouts. Unsupported platforms, versions, relocated sockets, and source configurations receive actionable limitations; macOS verification does not establish Windows or Linux support.

In the effective `.1mcprc`, enable automatic preparation by **configured server name**, for example:

```json
{ "preparation": { "codegraph": { "enabled": true } } }
```

Without this opt-in, automatic preparation is disabled. An explicit `prepare` command still obeys runtime-owned actions and target permissions. Linked worktrees can inherit the main checkout's preferences; a local file replaces the inherited configuration as a whole. Retain other desired settings when creating that local file. See [project checkouts and sets](/guide/project-checkouts).

Full rebuilds, dependency installation, and paid operations are not granted by initial indexing or incremental synchronization. This verified adapter supports `initialize` and `sync`; incompatible or interrupted indexes can require a separately verified recovery procedure.

## Keep CodeGraph Discovery Read-Only

Configure the first-party `codegraph-readonly` launcher as the backend's normal stdio command when using runtime-managed preparation. It uses the pinned native read-only engine rather than starting another indexing writer:

```json
{
  "mcpTemplates": {
    "codegraph": {
      "command": "/absolute/path/to/1mcp",
      "args": [
        "codegraph-readonly",
        "--executable=/absolute/path/to/already-installed/codegraph",
        "--path={{project.path}}"
      ],
      "template": { "shareable": true },
      "protocolVersion": "legacy",
      "projectTarget": { "mode": "single" },
      "preparation": {
        "adapter": "codegraph",
        "executable": "/absolute/path/to/already-installed/codegraph",
        "expectedVersion": "1.6.2",
        "sourceMonitor": "git-fsmonitor",
        "allowedActions": ["initialize", "sync"]
      }
    }
  }
}
```

Use this command in a checkout-bound template alongside the preparation metadata. Keep the existing template configuration and filters. The runtime owns the ordinary stdio lifecycle; this launcher does not replace another configured command automatically. The launcher accepts only its configured checkout; a tool argument cannot redirect it to another source tree. A writer started by an unrelated native CLI or runtime remains a conflict and is never killed or reclaimed by preparation.

## Inspect and Control Preparation

These commands use the selected Aggregated Runtime directly and remain reachable even when the backend initially advertises no tools:

```bash
1mcp preparation status codegraph --project /work/frontend --format json
1mcp prepare codegraph --project /work/frontend --format json
OPERATION_ID='operation-id-from-prepare-response'
1mcp preparation wait codegraph "$OPERATION_ID" --project /work/frontend --wait-ms 5000
1mcp preparation cancel codegraph "$OPERATION_ID" --project /work/frontend
1mcp preparation retry codegraph "$OPERATION_ID" --project /work/frontend
```

Replace the example `OPERATION_ID` value with the ID returned by `prepare`. Retain the same checkout, runtime selection, and authentication when using an operation ID. IDs are bound to the authorized target and caller; another caller's ID does not grant status or cancellation authority. `status` without an ID inspects current readiness. `retry` without an ID can reconcile a retained failure after runtime restart. Preparation requires verified local checkout context and preserves existing authentication, authorization, and filters; it issues no new remote trust.

For a saved project set, replace `--project /work/frontend` with `--project-set /work/projects.json --project frontend`. Prepare members individually; selecting several members does not fan out a single-project backend operation.

Inspection performs no source, configuration, Git-index, or CodeGraph-index mutation. It can run bounded read-only native probes but does not start indexing or a source monitor. Native Git journal queries may create and remove internal coordination cookies. They provide a source-change observation barrier; an ordinary filesystem watcher or an elapsed timer alone cannot prove freshness.

## Pending Is Not a Tool Result

A relevant tool request can start or join one compatible preparation job. Its default wait budget is five seconds. If preparation is still running, the response reports pending state, an operation ID, and recovery instructions. **The original backend operation did not execute and is not queued for replay.** Check status or wait, then submit the original operation again once ready.

This wait budget includes readiness probes and connection setup before dispatch. Once the original operation starts, it uses the normal tool timeout. Background preparation and its final readiness verification share the execution budget; a foreground wait expiring does not cancel them.

Successful preparation triggers capability refresh. Newly available tools remain subject to the selected checkout's filters and existing authorization. Ready, unrelated tools do not wait for another checkout's preparation.

Readiness is checked for the intended operation. Source edits, newly added or deleted files, branch changes, incompatible formats, partial coverage, and journal-history loss can invalidate readiness. Warm journal checks reuse only a validated baseline; they do not treat database existence or Git HEAD as proof of current source.

## Budgets, Failure, and Recovery

Defaults are one active expensive job, at most 16 queued jobs, a five-second request wait, and a two-minute execution deadline. Queue time does not consume the execution budget. Compatible calls deduplicate before queue admission. Distinct targets or incompatible configurations retain distinct job identities; queue overflow returns busy.

Configure runtime limits in `config.toml` next to the selected MCP configuration:

```toml
[preparation]
concurrency = 1
queueCapacity = 16
requestWaitMs = 5000
executionDeadlineMs = 120000
maxRecords = 1024
```

A backend can also declare an explicit `executionDeadlineMs` in its runtime preparation metadata. Increasing a budget requires a deliberate runtime configuration change; repeated requests do not silently relax it.

Disconnecting one waiter or reaching its wait deadline leaves shared preparation running. Explicit cancellation and execution expiry stop only owned preparation work. Failure remains visible until explicit retry or verified native evidence resolves it. Deadline exhaustion requires a larger explicit execution budget before another long attempt; partial indexes are preserved only where supported natively. A retry rechecks native readiness. If the index now requires a different recovery action, retry preserves the failure and returns explicit recovery instructions; it does not switch actions or grant a rebuild.

After restart, saved state is advisory. The runtime rechecks native readiness and ownership; saved running flags and process IDs are never permission to signal a process. It does not break foreign locks, delete an index, reuse another checkout's index, or restart a failed job automatically. A forced worker exit can leave native locks whose ownership is uncertain. Those locks are retained for explicit manual reconciliation. Follow the reported prerequisite or recovery instructions when preparation is unsupported, incomplete, or conflicting.

## Verified native measurements

On 2026-10-11 (Asia/Shanghai; 2026-10-10 UTC), CodeGraph 1.6.2 with Git 2.52 on Darwin arm64 was verified through initialized HTTP/SSE and the 2026-07-28 request flow. The cold fixture contained 20,000 source files with five functions per file, about 10 MB of source.

| Observation                                                        | Measured result                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Cold indexing / subsequent readiness verification                  | 13.97 s / 5.47 s, sharing the 120 s background budget |
| Foreground pending response / unrelated ready tool during indexing | 5.14 s / 98 ms                                        |
| Warm native readiness probes                                       | Median 27 ms, range 17–58 ms across 30 probes         |
| Ten warm HTTP status/query rounds                                  | 6.32 s; no new preparation or full inspection         |
| Default scheduling with 18 additional targets                      | One active job, 16 queued, two busy responses         |

The same initialized consumer received the catalog change and queried the selected source. Linked and independent checkouts, immediate edits, branch switches, disconnected waiters, cancellation, and foreign-lock reconciliation passed. A configured 1 s execution deadline stopped its owned writer. A subsequent explicit 120 s budget still denied rebuild-required recovery under `initialize`/`sync` permission; the database was preserved and no new writer started.

These measurements are observations, not resource or latency guarantees. Across 150 scoped process samples, the observed per-process maxima were 645.6% CPU and 2,511,040 KiB RSS, at different processes/times; external host contention was not measured. The test exercised an actual configured 1 s expiry, not an elapsed default 120 s expiry. Partial/incompatible metadata fixtures verified diagnostics and were restored; they do not establish coverage for naturally corrupted files. Verification is specific to this native version/platform and does not establish installed client-hook activation.
