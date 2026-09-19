---
status: accepted
---

# Legacy runtime recovery requires verified ownership

Upgrading the CLI while an older **Aggregated Runtime** remains active can leave lifecycle metadata without process-incarnation evidence. On Linux, explicit `serve --stop` and `serve --restart` may recover a legacy **Background Runtime Supervisor** and its live worker only when procfs evidence positively establishes ownership of the selected **Runtime Scope**. Other legacy states retain their metadata and receive actionable guidance; a PID, executable name, or HTTP identity response alone does not authorize termination or cleanup, and status or attach-only **Client Surfaces** do not initiate recovery.

macOS and Windows use guided one-time migration through operator verification and the original CLI or service manager. This deliberately trades automatic legacy migration for lower maintenance: a custom native reader and its build, packaging, and extraction lifecycle are disproportionate to this compatibility transition. Existing persisted-identity handling and normal restart behavior remain unchanged; flattened command text is not substituted for exact argument evidence.

Linux recovery verifies the worker's claim, parent, user, namespaces and scope files, stops the supervisor first, and revalidates ownership and process identity before subsequent signals or cleanup. Real older-version upgrade tests gate Linux recovery; non-Linux tests verify refusal, record preservation, guidance, and normal restart after operator-controlled migration.
