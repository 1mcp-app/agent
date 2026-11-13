# Product Usage Telemetry distribution verification

Use this guide when changing packaging or preparing a release candidate. It verifies installed npm modules, native binaries, and their compatibility with the independent telemetry service. Product collection and Operational Telemetry remain independent.

## Build and verify an artifact pair

Use the repository Node version and package manager from `.node-version` and `package.json`. Preserve existing installation state; all CLI experiments must use isolated test environments. Run gates serially when they build or exercise artifacts.

1. Check out the exact agent revision and clean service revision `034b40fbf644e7a10df009c6554721b54318c9a6`. The service repository is a separately owned prerequisite. Do not copy it into the agent package.
2. Run `pnpm check` and `pnpm docs:build`. Build with `pnpm build`; pack with `pnpm pack --pack-destination "$TASK_DIR"`. Install that tarball into a new directory with `npm install --ignore-scripts --offline --no-audit --no-fund "$TARBALL"` (a populated dependency cache is required). Record the lockfile and actual tool versions.
3. Run `pnpm sea:build` and `pnpm sea:binary` for the current native platform. Run the service's `pnpm check` in its separately owned checkout. Never infer cross-platform acceptance from a locally created native binary.
4. Run the artifact journey below. `$PACKAGE` is the installed `node_modules/@1mcp/agent` directory, not the source tree. `$SEA` is the actual CLI executable produced above. `$EVIDENCE` is a new private OS-temporary directory.

```bash
node scripts/verify-product-telemetry-distribution.mjs \
  --service "$SERVICE_CHECKOUT" --package "$PACKAGE" \
  --archive "$TARBALL" --sea "$SEA" --out "$EVIDENCE"
node scripts/verify-product-telemetry-delivery.mjs \
  --package "$PACKAGE" --sea --out "$EVIDENCE/delivery.json"
node --test test/release/product-telemetry-distribution.test.cjs
```

The package manifest explicitly excludes `build/.tmp/**`: the pinned pnpm 12 packer does not apply the nested build ignore file to these artifacts. The package E2E creates and removes its own synthetic scratch sentinel, so a clean runner also proves that exclusion. Existing scratch state is never deleted to make the test pass.

The manifest pins agent/service revisions, schema 1, installed runtime files, tarball, native CLI, separate synthetic Node/SEA fixtures, service Worker/dashboard bundles and migration using SHA-256. Recheck hashes before release and retain the tarball, lockfiles and manifest together. Tampered bytes and unsupported schema versions fail the manifest check. The private output contains synthetic UUIDs and local paths; publish a redacted acceptance summary, not that private directory.

The real installed CLI and actual CLI SEA prove local controls and hard test suppression despite enablement and CI opt-in. Every test-owned CLI remains suppressed. They do not export synthetic facts. A separate fixture bundles **installed production modules**, emits closed facts through their public facade/store, and runs under both Node and its own SEA. That fixture proves packaging parity at those module seams; source-owned hook and lifecycle suites prove the application integration. There is no endpoint override or test-enablement backdoor in the shipped CLI.

The harness executes the service's canonical release build and copies its generated `dist` bundles into the private evidence directory. Only ignored build output changes; service source stays untouched. Local Miniflare executes those bundles; the packaged scheduled handler operates on the same local D1 binding. Signed local Access assertions protect real bundled dashboard assets/API responses rendered in Chromium. Browser routing goes only to the local Worker; this is not deployed browser or policy evidence.

## Interpret failures

- **Manifest or hash mismatch:** rebuild and verify the exact artifact pair intended for release. Do not reuse a manifest after modifying packaged bytes.
- **Service revision mismatch:** use the receiver revision required by the harness, or update the compatibility fixture deliberately with the service change.
- **Package/module failure:** compare the installed package contents with the source build, including SEA worker assets and excluded temporary files.
- **Persistence or reporting failure:** inspect local D1 and rollup results separately from ingest responses. Use [delivery testing](product-telemetry-delivery.md) for late, stale, and unavailable states.
- **Platform-specific failure:** reproduce on that platform. A synthetic module fixture and an actual CLI binary test cover different boundaries.

The [distribution harness](../../scripts/verify-product-telemetry-distribution.mjs) owns fixture totals, schema rejection, retention, and scheduled-handler assertions. Local scheduled invocation does not establish that production cron runs. Keep manifests and observed results with the release or CI run, rather than appending them to this guide.

## Release preconditions and operator procedure

Keep the release inactive until every applicable row has independent evidence. A completed local harness does not satisfy a live row.

| Precondition            | Required evidence                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source auditability     | [ADRs 0024](../adr/0024-first-party-product-usage-telemetry.md) and [0025](../adr/0025-product-telemetry-service-has-a-separate-repository.md) require a public-source first-party service. Verify current source auditability against that decision before release.                                                                            |
| Ownership and budget    | Correct Cloudflare account, separately owned D1 database and Worker/domain names; named operator, spending/rate/storage limits and alerts. Never create them through this fixture.                                                                                                                                                              |
| Schema before ingest    | Backup/recovery procedure; migration review and local migration/rollback evidence; live schema readback before producer activation.                                                                                                                                                                                                             |
| Routes and Access       | Verify custom domain ownership/DNS, Access issuer/audience/domain allowlist, and policies covering page/assets/API. From unauthenticated and authorized external sessions check every route plus preview/workers.dev/alternate-host behavior. Local signed-token tests do not verify live policy. Disable unnecessary alternate/preview routes. |
| Privacy and diagnostics | No request-body/IP/UUID logging; no analytics vendor forwarding; bounded failure reasons only; owner-only local state; report is aggregate-only/read-only. Inspect configured platform logs rather than assuming application logging is the only source.                                                                                        |
| Schedule and retention  | Cron configured; independent recent successful rollup and retention timestamps; pending/dirty-day backlog bounded; 90-day detail, at-most-12-month linked history/inactive identities, indefinite UUID-free totals. Alert on stale schedule/retention without logging identities.                                                               |
| Producer release        | Exact signed artifact hashes and both revisions, schema fixture compatibility, final hosted platform checks, notice/controls/CI/test exclusion, approved endpoint ownership and producer activation authorization.                                                                                                                              |
| Dashboard               | Valid Access assertions required for all assets/APIs, no write API, bounded date/dimension queries, truthful missing/stale/provisional/error states and separate CI segment.                                                                                                                                                                    |

Sequence: verify account/permissions and backup; install schema; deploy the separately approved service revision with collection inactive; verify route protection, budget, retention and rollup health; record compatible producer artifact hashes; only then perform separately authorized producer activation. Keep migration and service rollout owners named in the release record.

Rollback: stop new producer release/activation, use the verified off-switch as appropriate, retain compatible schema and restore the last verified service/artifact pair. Do not replay claimed attempts: sends are final even when ambiguous. Preserve UUID/preferences unless an explicit reset is intended. Reset clears local identity/unsent data, not already ingested history. Retain aggregate totals during maintenance. Confirm health and authenticated reports after rollback; document missing observations instead of presenting them as zero.

For an incident, start with bounded aggregate health timestamps, pending days and coarse error status. Avoid exporting bodies, UUIDs, IPs, authorization headers, request logs or local state. Request-level outcomes, queue loss, missing coverage and customer impact are different evidence. The relevant user references are [controls](https://docs.1mcp.app/commands/telemetry), [operations](https://docs.1mcp.app/reference/product-telemetry-operations), [adoption](https://docs.1mcp.app/reference/product-telemetry-adoption) and [configuration](https://docs.1mcp.app/reference/product-telemetry-configuration).

## Scope of the result

Keep local source checks, packaged module checks, actual CLI Node/SEA checks, service local checks, hosted platform checks, live policy, deployment and activation as separate acceptance rows. This package performs no real collector request, production migration, deployment, Access/DNS/account change or activation. Final release needs hosted checks on the actual final agent revision and independent live evidence. Retain any unexercised platform/elevated-owner branch as a coverage gap.
