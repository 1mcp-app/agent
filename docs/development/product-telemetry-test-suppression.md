# Product Usage Telemetry test suppression

Issue [#676](https://github.com/1mcp-app/agent/issues/676) establishes test safety before producer hooks are introduced. It does not enable collection, implement installation storage, or change Operational Telemetry.

## Bootstrap contract

Test launchers set `ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED=true` after merging custom environment overrides. The hidden global boolean `--product-telemetry-test-suppressed` enters the existing yargs configuration boundary and is available on typed `GlobalOptions` and `ServeOptions`. Launcher suppression dominates a command-line false. Generic `NODE_ENV`, `TEST_MODE`, CI, paths, process names, and clientInfo never infer suppression.

`configureProductTelemetryBootstrap` records a monotonic process decision: once suppressed, later options or a replacement bootstrap cannot re-enable collection. `initializeProductTelemetry` fails closed before bootstrap and returns before invoking the supplied initializer when suppressed. All future product producers must enter through this boundary **before** reading installation identity/preferences, opening a queue, registering timers/hooks, or constructing delivery. Suppression is execution-local: do not store an opt-out, erase an existing queue, reset an identity, or mutate another process's preference. Later stored/default/process enablement and CI opt-in must be evaluated only inside this boundary. Explicit local control commands remain responsible for their requested local mutations.

Detached legacy supervisors materialize the typed flag into worker arguments. Cooperative supervisors/workers apply the private launch option as well as the ordinary parser decision. Frozen Runtime Scope environments cannot reverse an already suppressed decision. A suppressed proxy must not authorize collection in a remote runtime: ordinary tests select only test-owned Runtime Scopes and controlled fixture targets.

## Launcher coverage

- Unit, E2E, and protocol Vitest setup clears ambient `ONE_MCP_*` settings, gives each test file a temporary empty default Runtime Scope and home directory (isolating the user-global Runtime Target Store), clears host session/owner locators, and forces suppression. The explicit SEA binary path is retained. A test may select its own temporary fixture scope.
- `CommandTestEnvironment`, both `CliTestRunner` merge paths, `TestProcessManager`, `SimpleMcpClient`, `McpTestClient`, and the bespoke internal-tools client enforce suppression after overrides.
- Direct spawns/forks inherit that isolated environment. Launchers that remove ambient `ONE_MCP_*` variables (cooperative Node/SEA, modern template context, disabled-server reload) explicitly reapply the invariant.
- Protocol runners and minimal conformance bridge/matrix environments explicitly carry suppression. Legacy-upgrade, credential smoke, performance, and Unix/Windows binary launchers do the same. Binary jobs use temporary Runtime Scopes.

Use `createTestProcessEnvironment(overrides, base)` last at a new launch boundary. Its base must already select a test-owned scope and controlled targets; the helper enforces suppression and locator removal, not destination validation. After scrubbing ambient variables, pass the clean environment as the second argument so the default ambient base cannot restore removed targets. Use `isolatedTestEnvironment` when no fixture-owned default scope exists. Never select the developer's Runtime Scope, ambient remote URL/context, or bootstrap credential. Keep fixture endpoints loopback or otherwise controlled by the test. A cleanup that strips ambient variables must reapply suppression afterwards, including SEA launches where Node preloads are unavailable.

## Verification boundary

Controlled unit/component fixtures may exercise an injected synthetic producer against controlled state/destinations separately from ordinary E2E. There is no telemetry-enabled E2E exception and no test may contact a real product collector. The bootstrap tests verify that suppressed initialization is never invoked and existing synthetic operator preference/identity/queue contents remain unchanged. Process fixtures exercise the built parser with CI and conflicting false flags. Existing lifecycle/protocol tests retain their own readiness, protocol stdout, and cleanup checks.

Installation storage, actual outgoing payload validation, live preference/reset behavior, and collector compatibility remain acceptance work for later producer/service slices. Once those exist, extend this boundary fixture to their actual public initializer and controlled collector; do not infer these unimplemented behaviors from a passing suppression test.
