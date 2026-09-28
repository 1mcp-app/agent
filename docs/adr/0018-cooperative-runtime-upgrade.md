---
status: accepted
---

# Cooperative runtime upgrade

The agreed scope for **Runtime Upgrade** is activation of an already-installed version, with a brief service interruption and bounded draining of active calls. Automatic upgrades target responsive, protocol-compatible supervisors; unsupported versions and unresponsive owners remain explicit recovery cases under the existing ownership guarantees. These boundaries avoid adding package installation or live-session transfer to the upgrade contract.

If draining reaches its deadline, the coordinating CLI defaults to stopping the authenticated current supervisor and its worker, then activating the replacement after ownership is released. It reports the last observed unresolved request count and warns that unfinished calls may be interrupted and are never automatically replayed. `--on-drain-timeout abort` preserves abort-and-resume behavior. If the replacement fails after the old runtime stops, activation reports failure with scoped recovery commands rather than automatic rollback. If the coordinating CLI disappears during that gap, the scope may remain stopped until an explicit retry.

The replacement reads the current configuration files and applies preserved explicit launch overrides, while taking defaults for unspecified settings from the new version. Strict validation precedes stopping the old runtime, and the validated configuration is frozen for that replacement so subsequent file edits cannot alter activation. Explicit-input provenance must be recorded before defaults are materialized; older runtimes lacking required provenance or protocol support use the explicit migration/recovery path.

The existing `serve --restart` command activates the invoking installation by replacing both supervisor and runtime. Attach-only commands never initiate upgrades. Draining waits for active requests dispatching backend work, excludes idle sessions and persistent connections, and rejects new work with a retryable response. Sessions disconnect after active work finishes or the deadline policy requests stop. The configurable drain deadline defaults to 30 seconds; the deadline action defaults to `restart` and is not persisted as a launch override.

The supervisor's reversible preparation protocol still resumes admission at expiry if no commit occurred, including when the coordinator disappears. The CLI uses the existing authenticated `stop` operation on the same generation after an observed deadline abort, so already-running compatible supervisors can be restarted without a new protocol. Admission can briefly reopen between expiry and stop. An abort observed before the deadline does not authorize this fallback. A lost stop response is reconciled through ownership observation, never by repeating stop; failed retirement, changed ownership, incompatible control, or unreachable control do not authorize takeover. Retirement observation remains bounded to 30 seconds and failure includes status and recovery guidance.

**Runtime Activation** completes when the intended new supervisor/runtime generation owns the scope, has loaded the validated configuration, and accepts control and client connections. Activation is distinct from service health: failed, restarting, crash-looping, or still-loading backends are reported separately and do not fail activation by themselves. Existing health checks remain health signals rather than being weakened to represent activation.

The behavioral contract is accepted and implemented for compatible background runtimes. Normal cooperative replacement must preserve ownership and context-authority protections; timeout or a public identity response alone never authorizes takeover. Existing recovery guarantees remain authoritative.
