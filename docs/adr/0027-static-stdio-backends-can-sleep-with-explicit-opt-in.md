---
status: proposed
---

# Static stdio backends can sleep with explicit opt-in

Backend Sleep is explicitly opt-in for static stdio backends because waking creates a fresh backend session and loses process-local state. Sleeping servers remain enabled and discoverable, with operations waking them automatically. The scope and state-loss choices were confirmed on 2026-10-14; the complete lifecycle contract remains proposed.

## Consequences

Template Server Instance cleanup and remote HTTP/SSE backends are outside this version's scope. Existing static servers retain their behavior unless the operator accepts session and process-local state loss. Sleep remains distinct from disabling a server or recovering an unexpected exit; the Capability Catalog continues to own visibility, routing, and refresh.

### Unresolved lifecycle decisions

- The definition of idle, including in-flight work, subscriptions, and connected but inactive clients.
- Which operations wake a backend, and how sleeping capability metadata is presented and refreshed.
- Initial startup behavior, timeout configuration, and activation of policy changes.
- Concurrent wake requests, cancellation, failures, and configuration changes during transitions.
- Process ownership and evidence required to declare resource release complete.
- Operator diagnostics and acceptance criteria.

### Related decisions

- [Aggregated Runtime owns backend stdio supervision](0010-aggregated-runtime-owns-backend-stdio-supervision.md).
- [Capability Catalog owns visibility, routing, and refresh](0004-capability-catalog-owns-visibility-routing-and-refresh.md).
