---
status: accepted
---

# Backend preparation separates orchestration from native semantics

The **Aggregated Runtime** owns generic **Backend Preparation** orchestration, while configured integrations own native initialization, synchronization, freshness, and operation-specific readiness evidence. Integrations use configured commands and read-only probes rather than an in-process plugin system. This avoids coupling runtime delivery to each backend’s native lifecycle while preserving explicit authority, owned-process cancellation, and truthful readiness.

## Consequences

Integrations declare literal executable/argument commands and read-only probes with explicit exit-code mappings. Readiness must cover the selected checkout, operation, freshness, and coverage; connectivity, index presence, or successful command exit is insufficient. Unmapped results remain unknown. Tools explicitly requiring readiness stay blocked without it; ordinary ungated calls retain native behavior.

The runtime owns asynchronous jobs, deduplication, deadlines, and cancellation of owned processes. Inspection is read-only. Each job performs one authorized action, reprobes afterward, and never executes or replays the original tool call. Retries require explicit action except for configured bounded transient retries. Uncertain writer ownership or unsupported process containment blocks preparation.

[ADR 0028](0028-preparation-integrations-start-with-configured-definitions.md) amends the original exclusion of shipped helpers and separate fresh-worktree opt-in: maintained command helpers and explicit setup-time activation are permitted. It preserves backend ownership of native semantics and existing configurations' authority boundaries.
