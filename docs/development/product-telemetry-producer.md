# Product Usage Telemetry producer development

Use this guide when changing collection hooks, installation state, or runtime lifecycle behavior. [ADR 0024](../adr/0024-first-party-product-usage-telemetry.md) defines the collection contract; [ADR 0025](../adr/0025-product-telemetry-service-has-a-separate-repository.md) separates agent and service ownership. User controls are documented in the [telemetry command reference](https://docs.1mcp.app/commands/telemetry).

## Choose the verification boundary

From the repository root, use the repository Node and package-manager versions:

```bash
pnpm test:unit src/productTelemetry src/config/productTelemetryBootstrap.test.ts src/globalOptions.test.ts src/commands/shared/commandRunner.test.ts
pnpm build
pnpm test:e2e test/e2e/commands/telemetry.test.ts test/e2e/commands/inspect.test.ts test/e2e/commands/help.test.ts
```

Finish builds before running tests that consume their artifacts. Source tests exercise controlled state and injected producers; built CLI tests check parsing, local controls, and suppression. Ordinary E2E always suppresses collection; see [test suppression](product-telemetry-test-suppression.md) before adding a launcher. Use [distribution verification](product-telemetry-distribution.md) for installed npm and native binary changes.

## Preserve ownership and lifecycle semantics

Collection enters through the typed bootstrap boundary before accessing identity, preferences, queues, or delivery. Configuration observations alone must not create an identity or usage. Use closed product labels through the [producer facade](../../src/productTelemetry), rather than arbitrary command names, payloads, or diagnostic text.

Assign each outcome one owner. A background start's parent owns the command outcome; a supervised worker owns its runtime-start feature. Startup success, failure, and cancellation must finish at most once. Keep foreground output and exit behavior independent of telemetry, including failures writing the notice.

Generation-fenced state prevents activity from being relabeled after reset or preference changes. A stale ticket is dropped. Preference observation can stop local work but cannot recall transmitted bytes. Background collection and delivery must not keep the foreground process alive; explicit local control commands must wait for their requested mutation. There is no shutdown flush.

## Check agent/service compatibility locally

The [paired harness](../../scripts/verify-product-telemetry-pair.mjs) requires the independent service checkout at revision `034b40fbf644e7a10df009c6554721b54318c9a6` and refuses another revision. Install that checkout's dependencies, then run from the service checkout:

```bash
pnpm exec tsx /absolute/agent/scripts/verify-product-telemetry-pair.mjs \
  --service /absolute/telemetry \
  --out /absolute/private-temporary-directory/pair
```

Add `--runtime` when changing startup attribution. The harness bundles current agent source and submits its serialized bytes through local Miniflare. It reconciles persistence and reports with independently computed fixture expectations. A successful run establishes local compatibility with that pinned receiver, not deployed service health. Keep emitted bodies, identities, hashes, and reports in private run artifacts; link a summary from the PR.

If the harness rejects the service revision, use its required checkout or deliberately update the compatibility fixture with the receiver change. Do not remove the revision check to obtain a pass. For send faults and stale reports, use [delivery testing](product-telemetry-delivery.md).

## Diagnose local state failures

The installation store serializes mutations with private ownership records. Ambiguous ownership, including PID reuse or permission errors, must not be treated as a dead process. Corrupt state is retained and refused rather than regenerated. A crash after final removal can lose a claimed batch; replaying the attempt would violate delivery semantics.

For abandoned guards or malformed ownership records, stop all local producers and independently establish owner absence before removing only the inspected coordination directories. Preserve state, epoch, generation, and preference. Never infer safe recovery from age alone.

Permission failures require checking the actual owner and access rules. POSIX mode checks do not verify Windows protected ACLs or elevated-owner behavior. For Windows changes, inspect the hosted [native credentials workflow](../../.github/workflows) results and the [state verification harness](../../scripts/verify-product-telemetry-state.mjs); a local macOS run cannot establish Windows support.
