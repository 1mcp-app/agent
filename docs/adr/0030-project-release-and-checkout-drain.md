---
status: accepted
---

# Separate caller release from checkout drain

Project Release removes only the caller’s bindings; Checkout Drain separately closes checkout-wide admission while existing work drains. This prevents one caller’s completion from interrupting another and prevents reconnection between checking an unused checkout and removing it. Both operations preserve prepared indexes and configuration, and only an authorized operator may drain a checkout.

## Consequences

Release is caller-scoped; drain requires operator authority and rejects new work from existing owners as well as new bindings. Active requests and preparation jobs may finish; subscriptions and other owners remain explicit blockers. A timeout leaves admission closed, including across runtime restart, until explicit resume. Only complete drain permits the manager to proceed with its separate unrelated-process checks and deletion.

Each agent and worker owns an independent identity across invocations. Unverifiable identity cannot authorize broad release. Automatic release requires a verified lifecycle-end event; turn completion is insufficient. Operations are idempotent and preserve prepared artifacts.

The command family is `1mcp project`; preparation moves beneath it without root aliases because the feature was unreleased. Drain/resume select one checkout; release/status can report selected project-set members separately. Drain succeeds only when complete, whereas successful status inspection may report an incomplete drain. Direct worktree-manager integration is follow-up scope.

Trusted startup may establish a fresh owner generation after a recorded lifecycle end, retaining the previous generation and its unresolved leases. Generation selection is serialized per hook identity; cleanup is pinned to its selected owner and removes a thread locator only when it still references that generation. This restores resumed-chat admission without reopening ended authority. Versioned caller leases carry process-birth evidence; conclusive caller termination permits lease reconciliation, but runtime release proof remains necessary for terminal credential deletion. Legacy or uncertain leases are never cleared by age.
