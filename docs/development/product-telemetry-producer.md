# Product Usage Telemetry producer acceptance

Issue #677 implements the installation store, typed policy, local controls and the `inspect` command seam. Issue #678 adds runtime startup ownership and live controls. Full CLI coverage and runtime operation hooks belong to subsequent tickets. The receiver contract is v1 from `1mcp-app/telemetry` revision `034b40fbf644e7a10df009c6554721b54318c9a6`.

## Public seams and checks

- Policy/global parser: explicit disable precedence, standard environment normalization, typed option validation, unconditional launcher suppression.
- `InstallationStore`: owner-only state, admission/notice, controls, atomic generation-fenced append and final claim. Synthetic subprocess fixtures bundle current source into a private OS temporary directory; they do not depend on `build/`.
- `ProductUsageProducer`: closed command completion, nonblocking initialization, bounded pending work and no stale ticket relabeling. Its `settled()` barrier exists only for controlled fixtures, never commands/readiness/shutdown.
- Notice fd writes: a closed-stderr child regression proves notice failure cannot emit an unhandled stream error or admit identity/queue, preserving the foreground stdout and exit.
- `runCliCommand`: opt-in closed inspect attribution before both JSON/text error presentation, synchronous throw and async reject, unchanged command output/status.
- Native delivery: at most two unreferenced Worker senders isolate DNS/socket handles from the foreground. Eval source needs no external worker file. Recent Node versions and native SEA use built-in proxy agents; older supported npm runtimes resolve the installed proxy-from-env and https-proxy-agent modules inside the worker. A ten-second unreferenced parent deadline terminates each worker. Controlled HTTP, TLS-handshake and referenced-pending-DNS fixtures prove foreground exit without the background deadline firing. No exit hook or shutdown flush exists.
- Built CLI E2E: help/version/status create no installation; local controls stay local under remote context/URL and never self-count. The ordinary E2E environment remains unconditionally suppressed.

```bash
pnpm test:unit src/productTelemetry src/config/productTelemetryBootstrap.test.ts src/globalOptions.test.ts src/commands/shared/commandRunner.test.ts
pnpm check
pnpm docs:build
# Synthetic source and private Node SEA, no ordinary E2E collection:
node scripts/verify-product-telemetry-delivery.mjs --sea --out /private/task/delivery.json
# Run only after build/check has finished rebuilding artifacts:
pnpm test:e2e test/e2e/commands/telemetry.test.ts test/e2e/commands/inspect.test.ts test/e2e/commands/help.test.ts
```

## Paired local service check

Clone and install the independently owned service at the pinned revision above. The reusable harness accepts an explicit checkout and refuses a different revision. Run it with that checkout's `tsx`; it does not bundle or modify service implementation.

```bash
# From the pinned service checkout; replace absolute paths with your private paths.
pnpm exec tsx /absolute/agent/scripts/verify-product-telemetry-pair.mjs \
  --service /absolute/telemetry \
  --out /private/task/pair-evidence
```

The script bundles the actual agent facade/store source, captures its serialized bytes, and sends those exact bytes only through the service's Miniflare harness. It reconciles D1 rows and rollup/report results with hand-computed human/CI command totals and reset identities; verifies exact replay, content conflict, unknown labels/outcomes and forbidden-field rejection; and proves unknown outgoing dimensions/arbitrary names/raw outcomes are dropped. Artifacts include actual bodies, private report, source hash, producer Git revision and pinned receiver revision. Re-run after committing so the revision identifies the delivered source.

## Coordination, crashes and limitations

All mutations serialize through a private main lock. A separate guard serializes acquisitions and demonstrably dead-owner reclamation; PID reuse or EPERM is treated as live/ambiguous. Release checks both PID and nonce. Fault fixtures terminate owned processes before owner publication, before/after temporary writes, before/after rename, during notice and after final claim removal. Simultaneous reapers, paused live owners, concurrent appends/claims, failed writes/renames, stale tickets and missing state are covered. Exact orphan temporary names are discarded under the lock; more than 256 directory entries fail closed for offline recovery. Temporary files never become authoritative state.

An abandoned guard or malformed/missing ownership record deliberately requires offline recovery. Stop every local producer, inspect coordination artifacts and independently establish owner absence, remove only those inspected coordination directories, retain `state.json`/epoch/generation/preference, then restart. Never recover by age. A crash after stderr notice but before state commit can repeat the notice. A crash after durable final removal can lose the claimed batch; attempts are never replayed. Corrupt state is retained and refused, never silently regenerated.

POSIX ownership/mode checks are exercised locally. Windows uses bounded asynchronous Windows PowerShell/.NET checks for a current-user protected inheritable ACL, verifies owner/rules and rejects reparse points. Only an exclusively created empty root or empty inherited entry may be assigned to the current SID before data is written; populated foreign-owner entries are refused. Status never repairs ownership. Coordination acquisition has a monotonic bounded wait (one second POSIX, five seconds Windows). No product data is admitted before verification. Explicit controls retain foreground references until their local mutation finishes; background collection's helper child, deadline and network socket are unreferenced. The ACL implementation follows [Microsoft FileSystemSecurity](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.filesystemsecurity?view=netframework-4.8.1) and [Set-Acl](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl?view=powershell-5.1). Local macOS tests do not prove Windows ACL/PowerShell availability or elevated-owner behavior; hosted Node/SEA platform checks remain required before a cross-platform release claim. The synthetic macOS Node/SEA sender check does not establish full distribution or runtime lifecycle acceptance; those remain #678/#683.

Public operator behavior is documented in [Telemetry Command](https://docs.1mcp.app/commands/telemetry).

## Hosted Windows gate

The Native OAuth credentials workflow also runs `verify-product-telemetry-state.mjs` against the built Node CLI and actual SEA distribution on Windows, then runs the synthetic Node/SEA delivery check. All roots, HOME/USERPROFILE, Runtime Scopes and facts are fixture-owned, and ordinary CLI collection remains suppressed. Evidence is uploaded as `product-usage-windows-acceptance`. This checks help/version/status inertia, shared local scope, local controls despite remote selection, disable/reset identity behavior, current-user owner/ACL verification and stale tickets. An elevated token whose default owner differs from the user additionally proves existing populated foreign-owner entries are refused. The hosted workflow result must be read before claiming Windows acceptance.

## Runtime startup and shared controls (#678)

`serveCommand` owns one `serve` outcome for foreground starts (stdio connection or HTTP listening) and for the cooperative background parent after verified activation/restart. The supervisor emits no command. Each authorized supervised worker owns only the distinct `runtime_start` feature; automatic replacement is never a new user command. The legacy direct `runServeBackground` helper owns its own parent outcome. `proxyCommand` owns local `proxy` readiness after transport startup, including when attaching to a remote target. Startup guards arbitrate success/failure/cancellation once and remove their signal listeners on completion; no shutdown hook or flush is installed. Status/stop remain available for the later CLI-family ticket to classify; restart is already owned here.

The producer uses unreferenced five-minute send and two-second preference-observation timers. Windows privacy inspection has a separate three-second fail-closed deadline. Observation never admits an identity; generation/policy is reread on append and final claim. Observed invalidation drops the local ticket and pending configuration snapshot and terminates this process's delivery workers where possible. Already transmitted bytes cannot be recalled. Only later real activity can request fresh admission; facts with stale tickets are dropped, never retagged. Slow or failed filesystem observation suppresses once detected and cannot guarantee a wall-clock deadline during an OS/filesystem stall.

The closed facade exports `beginProductCommand(CommandName)`, `recordProductFeature(FeatureName, outcome)`, `recordProductOperation(OperationName, outcome, transport, client)` and `observeProductConfiguration('servers'|'tools', nonnegativeSafeInteger)`. Operation/client/transport labels come only from the v1 contract. Configuration snapshots store finite buckets in memory on an existing producer, attach once to later genuine activity, and create neither identity nor usage by themselves. Later tickets own their instrumentation and semantic observation points.

Run the existing local paired harness with `--runtime` to add hand-computed startup facts: human serve success1/failure2 (one cancellation), proxy success1/failure1, worker `runtime_start` success2/failure1, and CI serve success1. Duplicate finishes add nothing. Combined with the inspect fixture there are thirteen actual serialized batches, two human identities and two CI identities (reset creates the latter second identity). The script verifies these totals through local Miniflare, D1, rollup and the private report; it never contacts a deployed collector.
