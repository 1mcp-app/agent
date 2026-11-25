# Product Usage Telemetry delivery and freshness testing

Use this guide when changing send behavior or investigating missing and stale report data. Start with [producer development](product-telemetry-producer.md) for collection hooks and local state. Product Usage Telemetry is approximate and separate from Operational Telemetry.

## Run focused delivery checks

From the repository root:

```bash
pnpm test:unit src/productTelemetry/faults.test.ts src/productTelemetry/delivery.faults.test.ts
pnpm test:unit src/productTelemetry/installationStore.test.ts src/productTelemetry/installationStore.process.test.ts src/productTelemetry/delivery.process.test.ts
node scripts/verify-product-telemetry-delivery.mjs --sea --out /absolute/private-temporary-directory/delivery.json
```

The [delivery harness](../../scripts/verify-product-telemetry-delivery.mjs) exercises synthetic Node and SEA senders with controlled HTTP/TLS/DNS fixtures. Use it to check that pending delivery cannot keep the foreground alive. It does not enable ordinary CLI collection or verify a production endpoint.

## Exercise persistence and report faults

The [fault harness](../../scripts/verify-product-telemetry-faults.mjs) requires the independent service checkout at revision `034b40fbf644e7a10df009c6554721b54318c9a6`, its dependencies, and Playwright Chromium. Run from that service checkout:

```bash
pnpm exec tsx /absolute/agent/scripts/verify-product-telemetry-faults.mjs \
  --service /absolute/telemetry \
  --out /absolute/private-temporary-directory/faults
```

It submits actual serialized producer bytes to local Miniflare, reads D1 independently, and renders service assets using captured authenticated local responses. Browser rendering is controlled replay, not a live deployment check. Preserve generated artifacts privately; they include synthetic identities and request bodies.

Expect separate assertions for ingest acknowledgment, D1 persistence, rollup freshness, and report rendering. If a check fails, inspect the first boundary that differs rather than interpreting an empty report as proof that collection failed.

## Interpret missing data

| Observation                                       | Interpretation and next check                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Unattempted data remains queued                   | Check connection preparation, capacity, and later enabled activity before expecting a send. |
| A claimed batch has no acknowledgment             | Claims are final even after an ambiguous failure; do not replay the attempt.                |
| D1 contains activity but daily totals are missing | Check whether the period has been rolled up.                                                |
| A previously computed period is stale             | Check for late data and rebuild the affected rollup.                                        |
| Current-day values are provisional                | The UTC reporting day is still open.                                                        |
| A report request fails                            | Show unavailable and discard stale displayed values; zero would misrepresent the failure.   |

Queue eviction, expiry, short foreground activity, and crashes after final claim can lose facts. Local counts do not establish customer impact. The fault harness owns exact boundary values and fixture totals; update its assertions with behavior changes instead of copying them into this guide.

## Preserve the preparation/claim boundary

Connection preparation occurs before the durable claim. Failed preparation or foreground exit leaves unclaimed data available for later enabled activity. After connection readiness, the store rechecks generation and preference before releasing the payload. Preparation must not hold the installation lock, so reset and disable can complete while DNS/TLS is pending.

A reset fences later claims but cannot recall bytes already sent. Keep proxy agents scoped to the sender; tests must bypass ambient proxies for loopback fixtures. Verify both npm dependency resolution and SEA embedded assets when changing proxy support; use [distribution verification](product-telemetry-distribution.md).
