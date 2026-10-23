---
status: accepted
---

# Legacy runtime recovery requires verified ownership

Upgrading the CLI while an older **Aggregated Runtime** remains active can leave lifecycle metadata without process-incarnation evidence. On Linux, explicit `serve --stop` and `serve --restart` may recover a legacy **Background Runtime Supervisor** and its live worker only when procfs evidence positively establishes ownership of the selected **Runtime Scope**. Other legacy states retain their metadata and receive actionable guidance; a PID, executable name, or HTTP identity response alone does not authorize termination or cleanup, and status or attach-only **Client Surfaces** do not initiate recovery.

macOS and Windows use guided one-time migration through operator verification and the original CLI or service manager. This deliberately trades automatic legacy migration for lower maintenance: a custom native reader and its build, packaging, and extraction lifecycle are disproportionate to this compatibility transition. Existing persisted-identity handling and normal restart behavior remain unchanged; flattened command text is not substituted for exact argument evidence.

Linux recovery verifies the worker's claim, parent, user, namespaces and scope files, stops the supervisor first, and revalidates ownership and process identity before subsequent signals or cleanup. Real older-version upgrade tests gate Linux recovery; non-Linux tests verify refusal, record preservation, guidance, and normal restart after operator-controlled migration.

## Addendum (2026-10-23)

This addendum narrows one interpretation and extends the decision without overturning it. The original fail-closed rule for live owners is unchanged.

**A provably absent PID is not a live owner.** Missing birth evidence alone is never a death certificate, but a recorded owner PID that is shown not to exist on the host has lost its protected object. Reclaiming that stale metadata during a claim or an explicit recovery is metadata cleanup, not termination or takeover: every signal and termination path still requires positive birth evidence, and a live PID (including `EPERM` or an unreadable process state) with missing evidence remains held. Read-only discovery reports the resulting state as **Runtime Absence**, while a live PID with unreadable evidence remains a diagnostic unknown rather than absence.

**Degraded evidence is explicit.** A runtime that cannot acquire its own birth evidence within the bounded probe budget starts with `identityEvidence: { status: "unavailable", code, elapsedMs, at }` instead of persisting a legacy-shaped record with no evidence. While its PID is alive, every ownership check treats the record as held. Once the PID is gone, the provably-absent rule applies. A bounded background repair may atomically upgrade the same observed generation (PID and claim ID) from unavailable evidence to kernel evidence; it never crosses generations.

**Empty ownership directories are structurally stale.** Claims publish atomically by candidate-directory rename, so an empty canonical ownership directory cannot be a legitimate in-flight state and is reclaimed under the scope file lock. A directory containing unknown entries remains ambiguous and fails closed, naming the entries and giving operator guidance.

**Startup diagnostics are bounded.** A claim failure exposes closed-enum facts (`ownership_reason`, `evidence_status`, `acquisition_code`, `elapsed_ms`) with the raw error still redacted, writes a human-readable line to stderr, and appends one bounded line to an explicit `--log-file` when the file transport is not attached yet.

**Budgets.** The self-probe keeps the existing 3-second budget, and the claim's single observation is reused for the PID file. Repair attempts are delayed 10 seconds, back off exponentially to a 60-second cap, and stop after five attempts or on success. No native FFI/addon, self-attested evidence, or time-window reclaim is introduced.

**Durability and cleanup.** Identity repair writes its temporary file beside, not inside, the canonical ownership directory (the same filesystem is required for an atomic rename) and removes a partial write on failure, so a leftover sibling can never become an unknown ownership entry. Fallback cleanup (claim failure, reclaim finalization, startup failure, and process shutdown) uses a best-effort ownership release that is idempotent, releases the file lock before marking completion, and records a secondary failure without throwing or masking the primary error. Explicit lifecycle commands keep the verified, throwing release contract. The owner record is repaired first; the derived PID record reports repaired, skipped, retry, ownership-changed, or unsafe, retries transient failures, stops on a changed generation or unreadable-but-present metadata, and exposes an exhausted repair through bounded diagnostics and status. Unknown ownership entries are still never auto-removed; a known-residue exemption is not adopted because keeping temporary artifacts outside the canonical directory removes the residue class structurally.
