# Product usage delivery faults and freshness

This note records the controlled acceptance seams for agent issue #682. It supplements [producer acceptance](product-telemetry-producer.md). Product Usage Telemetry is approximate and separate from Operational Telemetry.

## Reproduce the paired check

Use Node from `.node-version`, the repository package manager, and the independently owned service checkout at `034b40fbf644e7a10df009c6554721b54318c9a6`. Install that checkout's dependencies and Playwright Chromium. From the service checkout:

```bash
pnpm exec tsx /absolute/agent/scripts/verify-product-telemetry-faults.mjs \
  --service /absolute/telemetry \
  --out /private/task/fault-evidence
```

The script bundles the current agent producer/store sources, uses a temporary installation, and submits actual serialized bytes exclusively through the service's local Miniflare ingest Worker. It never writes service source or contacts the deployed collector. The browser loads actual authenticated service assets through intercepted routes; API responses are captured from authenticated local Worker requests. Browser rendering is controlled replay of those responses, not live deployed UI evidence. All requests remain local. Evidence contains synthetic UUIDs and should remain private.

The independently worked example has one installation, two prior-day summaries (one success, one failure), and one current-day success. Before rollup, D1 has persisted activity but the report period remains missing. After the first rollup, a second late summary makes the old period stale until rebuilt. Two rollups and an exact batch replay leave totals at success **2**, failure **1**, prior-day summaries **2**, current-day summaries **1**, installation states **1**. An untouched intervening day stays missing with null values; the current day is provisional. A changed-content replay conflicts. The harness reads D1 rows independently of ingest status.

Quota rejection leaves D1 unchanged. A successful D1 write followed by a lost response remains final locally; a second send cannot duplicate it. A missing D1 table returns `storage_unavailable` with `persisted: false`; authenticated report failure returns `report_unavailable`, never a zero-valued report. The browser renders pending, stale, provisional, missing, elapsed-freshness and unavailable states, and hides old report values after a failed refresh. Seven-day lateness and five-minute future boundaries are checked with actual envelopes and a fixed receiver parser clock; eight-day-old and six-minute-future envelopes are rejected by the Worker. Artifacts pin agent/service revisions, producer source hash, actual bodies, reports and screenshots.

## Local fault coverage

```bash
pnpm test:unit src/productTelemetry/faults.test.ts src/productTelemetry/delivery.faults.test.ts
pnpm test:unit src/productTelemetry/installationStore.test.ts src/productTelemetry/installationStore.process.test.ts src/productTelemetry/delivery.process.test.ts
pnpm check
pnpm docs:build
```

The dedicated fixtures cover exact time boundaries, persisted expiry, later-execution carryover, competing claims and disable/reset while a request result is stalled. A real loopback HTTP fixture fills both sender slots, observes a third serialized-fixture sender being refused, waits for both stalled sockets to close at the ten-second deadline, and verifies global HTTP/HTTPS agents retain their identities. Existing store/process fixtures supply real serialized 256 KiB queue and 64 KiB/100-summary envelope bounds, oldest eviction, final durable claims, crash/ambiguous-result finality, failed local writes, dead-owner versus ambiguous coordination and stale generation races. Existing HTTP/TLS/DNS sender fixtures prove that an unreferenced worker/deadline cannot hold the foreground process open. They bundle source and do not depend on prebuilt artifacts or enable ordinary E2E collection.

## Interpretation and limits

Queued unattempted data may be sent on a later enabled execution within seven days. It is not a retry of an attempted batch. Eviction, expiry, admission delays, short final CLI activity and crashes after final claim can lose facts. Shutdown never flushes or waits. A control operation fences later claims using the old ticket, but cannot recall bytes already transmitted. Suppressed test processes do not clear another process's pending queue.

An ingest acknowledgment, D1 persistence and completed rollup are different observations. Missing is unknown, stale means persisted data has overtaken its rollup revision, and provisional means the UTC day remains open. Aggregate health and error labels must not include payloads, installation UUIDs, request IPs or raw exceptions. The harness's private synthetic evidence is not a diagnostic event or vendor forwarding path.

No production activation, hosted-platform acceptance or automatic production scheduler execution is established by these local checks. Service implementation remains separately owned; compatible source and local report/browser checks do not prove deployed revision or runtime health.

## Connection preparation and short-command exit

A real read-only CLI trace found the old sender was created after the durable claim, then killed by foreground exit before its worker thread started. Live producers now prepare an HTTP/TLS connection in an unreferenced worker before claiming a batch. Preparation uses a per-sender proxy-aware Node agent and has a ten-second total connection/request deadline. No summary is passed to the worker during preparation. Failed preparation, sender-capacity exhaustion, or foreground exit leaves the queue available for a later enabled execution, including the shared runtime's periodic send.

Preparation does not hold the installation lock. After connection readiness, the store reacquires the lock, rechecks the generation/preference, selects current unexpired data and makes the final durable claim before releasing the payload. Reset/disable can complete while DNS/TLS is pending. Already claimed attempts remain final, including ambiguous failures; this is not an acknowledgment/retry protocol. An exit after the final claim can still lose data. Tests cover queue preservation across process exit, proxy routing, reset fencing, and expired preparation. No new collector setting, synthetic production activity, or customer payload field is introduced.
