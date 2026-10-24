---
status: accepted
---

# Cooperative runtime upgrade

The agreed scope for **Runtime Upgrade** is activation of an already-installed version, with a brief service interruption and bounded draining of active calls. Automatic upgrades target responsive, protocol-compatible supervisors; unsupported versions and unresponsive owners remain explicit recovery cases under the existing ownership guarantees. These boundaries avoid adding package installation or live-session transfer to the upgrade contract.

## Consequences

`serve --restart` replaces both supervisor and runtime; attach-only commands never upgrade. Validate and freeze current configuration plus explicit launch overrides before stopping the old generation. Activation means the intended generation owns the scope and accepts connections; backend health is reported separately.

Draining rejects new work and waits only for active backend requests. At the deadline, default behavior stops the authenticated generation and activates its replacement; `--on-drain-timeout abort` resumes admission. Interrupted calls are never replayed, and failed activation requires explicit recovery rather than automatic rollback.

A lost stop response requires ownership reconciliation, never blind repetition or takeover. Explicit stale-generation recovery requires conclusive absence of every recorded process and revalidation under the lifecycle lock. Unknown liveness, conflicting ownership, incompatible control, and malformed evidence retain ownership and fail closed.
