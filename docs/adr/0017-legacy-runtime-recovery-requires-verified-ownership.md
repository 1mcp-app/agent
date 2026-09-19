---
status: accepted
---

# Legacy runtime recovery requires verified ownership

Upgrading the CLI while an older **Aggregated Runtime** remains active can leave lifecycle metadata without process-incarnation evidence, preventing subsequent stop or restart operations. Explicit `serve --stop` and `serve --restart` may recover a legacy local **Background Runtime Supervisor** and its live worker only when independent live evidence positively establishes ownership of the selected **Runtime Scope**, on platforms covered by real upgrade tests; other legacy states retain their metadata and receive scoped, actionable recovery guidance. This accepts limited automatic upgrade compatibility to preserve ownership safety: a recorded PID, executable name, or HTTP identity response alone does not authorize termination or cleanup, and status or attach-only **Client Surfaces** do not initiate this recovery.

Initial automatic-recovery targets are macOS and Linux, each gated by a real older-version-to-candidate upgrade test; Windows initially receives diagnostics and guided recovery. The verifier must use exact process arguments and OS process evidence, bind the live worker's claim and launch-config path to the selected scope, and account for worker replacement and foreign execution contexts, with ownership and observed process identities revalidated before signals and cleanup. Acceptance of this policy does not assert that automatic recovery has shipped; isolated feasibility experiments establish the evidence sources, while candidate CLI behavior and platform packaging remain implementation gates.
