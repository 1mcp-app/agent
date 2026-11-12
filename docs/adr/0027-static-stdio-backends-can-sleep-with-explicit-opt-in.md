---
status: accepted
---

# Static stdio backends can sleep with explicit opt-in

Backend Sleep releases idle static stdio processes while retaining discoverable capabilities and waking a replacement on demand. It requires explicit per-server opt-in because waking creates a fresh backend session and loses process-local state. Existing servers keep their behavior unless the operator accepts that trade-off.

This decision implements the contract published in [issue #739](https://github.com/1mcp-app/agent/issues/739). Backend Sleep remains disabled unless an operator opts in. Local verification and tested platform limits are recorded in [Backend Sleep acceptance](../development/backend-sleep-acceptance.md); implementation does not imply activation in a running configuration.

## Decision

The Aggregated Runtime owns intentional sleep and wake alongside backend lifecycle management. The Capability Catalog owns discovery, authorization, routing, and refresh across both direct and lazy tool exposure. A discoverable backend need not have a connected transport; an operation must establish a valid connection and current capabilities before dispatch.

## Lifecycle contract

### Scope and configuration

- Backend Sleep is opt-in per static stdio server, default off. Opt-in explicitly accepts loss of process-local state and a fresh backend session after wake. Do not infer that a server is stateless.
- Existing template cleanup and remote HTTP/SSE backends remain unchanged.
- Configure each static stdio entry with `sleep: { enabled: true, idleTimeoutMs: 300000 }`. The optional timeout accepts integers from 1 through 2147483647; omission uses 300000 ms. Omitted `sleep` stays disabled. Reject zero/invalid values and sleep policies on Template Servers or remote transports. Check eligibility every 30000 ms.
- Start opted-in backends normally at runtime startup, initialize them, and populate capability metadata. No persistent cross-runtime capability cache or cold-start discovery is required.
- Apply sleep-policy changes through configuration reload. Enabling sleep or changing the timeout starts a fresh idle window. Disabling sleep wakes a sleeping server to restore normal behavior. Server disable/removal and runtime shutdown take precedence over pending wakes.

### Idle eligibility and ownership

- Connected but inactive clients do not prevent sleep. Outstanding requests, subscriptions, asynchronous protocol tasks, and uncertain completion do prevent sleep. Caller timeout/cancellation alone does not prove upstream completion.
- Start the idle clock after initialization and capability refresh, or after the last operation/task completes or subscription releases, with no unfinished work remaining.
- Discovery-only traffic does not wake a backend or reset its idle clock.
- Stop only exclusively owned backend processes. Shared daemons keep their own lifecycle; release the connection without killing them.
- Unsupported or uncertain exclusive ownership blocks sleep. Failed shutdown is a release failure, never successful sleep. Do not launch a replacement while release/ownership remains uncertain.
- Work entirely hidden from the protocol cannot be inferred; document that opt-in accepts this limitation.

### Wake, concurrency, failure, and cancellation

- A backend operation wakes a sleeping server. Concurrent callers share one initialization attempt while retaining independent cancellation and deadlines.
- A canceled caller never dispatches; cancellation must not cancel another caller's work. If all callers cancel during startup, finish the bounded startup, dispatch nothing, and use ordinary idle expiry.
- Once shutdown begins, complete it before starting a replacement. Recheck current configuration and authorization before dispatch; a stale transition must not publish a removed/disabled/replaced backend.
- Refresh capabilities and revalidate the requested operation after wake. Removed capabilities or changed schemas produce appropriate errors rather than dispatch using stale metadata.
- Use existing startup deadlines. Wake failure returns an explicit error to waiting callers; never replay an operation or run a continuous background wake retry loop.
- After wake failure, enforce a 30000 ms cooldown. A later request can initiate another attempt; expiration alone does not trigger retry.
- Intentional sleep must not trigger crash supervision. Keep wake failure separate from the crash-recovery budget.

### Lazy loading and shared routing

Lazy loading and Backend Sleep are independent switches. Support all four combinations:

| Lazy loading | Sleep | Contract                                                                            |
| ------------ | ----- | ----------------------------------------------------------------------------------- |
| Off          | Off   | Preserve existing direct-tool behavior.                                             |
| On           | Off   | Preserve existing meta-tool behavior.                                               |
| Off          | On    | Keep cached direct tools advertised; direct calls wake the backend.                 |
| On           | On    | `tool_list` and `tool_schema` use cached metadata; `tool_invoke` wakes the backend. |

- The Capability Catalog owns discoverability, visibility, routing, and refresh. Distinguish discoverable capabilities from a live connected transport; do not solve this only in the lazy-loading orchestrator.
- Ordinary `tools/list`, tool/schema inspection, and status reads use last-known metadata without waking. Backend operations (tool invocation, resource reads, prompt retrieval, subscriptions, explicit refresh) wake when required.
- Sleeping metadata remains subject to current permissions, filters, and disabled-tool/server configuration. Keep protocol response schemas compatible; expose lifecycle/cache facts through appropriate existing status surfaces.
- Sleep alone must not remove advertised capabilities or cause tool-list churn. Actual capability changes after wake still use existing refresh/notification behavior.

### Operator visibility

Existing CLI/Admin status surfaces show sleep state, last activity, timeout, blockers, and wake/release failures. Use registered lifecycle events and existing privacy rules. Distinguish released owned processes from shared daemons that remain alive; do not equate sleep with reclamation of all associated memory.

## Rationale and consequences

Keeping all static processes alive avoids wake latency but retains memory indefinitely. Reusing a disabled-server state would remove discovery and require explicit re-enablement. Backend Sleep instead keeps an enabled target discoverable while reclaiming exclusively owned processes, accepting a fresh session and initialization latency on subsequent use.

Lazy loading remains independently configurable because reducing initial schema payload does not release processes. Cached capability metadata preserves discovery during sleep but requires current authorization and post-wake revalidation. Intentional release must remain separate from crash recovery so supervision does not undo the memory-saving policy.

The runtime cannot infer work hidden inside a backend or guarantee reclamation of independently shared daemons. Ownership uncertainty blocks release, and diagnostics distinguish released owned processes from external/shared memory still resident.

OS suspension retains the process and is not Backend Sleep. [Issue #740](https://github.com/1mcp-app/agent/issues/740) separately evaluates suspension, reclamation, and checkpoint/restore; it does not block the release/restart baseline.

## Acceptance criteria

- [ ] Default-off, template, and remote behavior remain unchanged; invalid configuration is rejected before activation.
- [ ] Deterministic tests cover timeout boundaries, initial idle baseline, policy reload, discovery-only traffic, active work, subscriptions/tasks, and uncertain completion.
- [ ] A real owned stdio fixture exits after idle expiry and restarts on demand; concurrent callers create one replacement and dispatch each uncanceled operation at most once.
- [ ] Direct and meta-tool modes pass the four-combination matrix, including cached discovery, permissions, filters, disabled tools, and capability changes after wake.
- [ ] Wake errors, deadlines, cancellation, cooldown, and all-callers-canceled startup follow the contract without replay or unintended background retries.
- [ ] Requests, reload, disable/removal, and runtime shutdown racing sleep/wake cannot publish stale replacements or trigger crash recovery for intentional sleep.
- [ ] Teardown distinguishes verified exclusive-process release, release failure, unsupported ownership, and shared daemons. Document tested platform coverage.
- [ ] CLI/Admin status, registered logs, schema/help, and bilingual public docs explain opt-in, state loss, latency, and ownership limits.
- [ ] Run repository-required checks, docs build, and relevant built process/protocol E2E lanes. Report local checks, hosted CI, and runtime activation separately.

## Out of scope

Template cleanup changes, remote HTTP/SSE reclamation, OS suspension/checkpoint modes, implicit stateful-server opt-in, persistent cross-runtime capability caches, new manual sleep commands, and memory dashboards.

## Related decisions

- [Aggregated Runtime owns backend stdio supervision](0010-aggregated-runtime-owns-backend-stdio-supervision.md).
- [Capability Catalog owns visibility, routing, and refresh](0004-capability-catalog-owns-visibility-routing-and-refresh.md).
