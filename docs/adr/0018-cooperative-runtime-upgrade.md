---
status: accepted
---

# Cooperative runtime upgrade

The agreed scope for **Runtime Upgrade** is activation of an already-installed version, with a brief service interruption and bounded draining of active calls. Automatic upgrades target responsive, protocol-compatible supervisors; unsupported versions and unresponsive owners remain explicit recovery cases under the existing ownership guarantees. These boundaries avoid adding package installation or live-session transfer to the upgrade contract.

If draining reaches its deadline, replacement aborts and the old runtime resumes accepting requests. Calls are not automatically replayed. If the replacement fails after the old runtime stops, activation reports failure with explicit recovery rather than automatic rollback. If the coordinating CLI disappears during that gap, the scope may remain stopped until an explicit retry.

The replacement reads the current configuration files and applies preserved explicit launch overrides, while taking defaults for unspecified settings from the new version. Strict validation precedes stopping the old runtime, and the validated configuration is frozen for that replacement so subsequent file edits cannot alter activation. Explicit-input provenance must be recorded before defaults are materialized; older runtimes lacking required provenance or protocol support use the explicit migration/recovery path.

The existing `serve --restart` command activates the invoking installation by replacing both supervisor and runtime. Attach-only commands never initiate upgrades. Draining waits for active requests dispatching backend work, excludes idle sessions and persistent connections, and rejects new work with a retryable response. Sessions disconnect after active work finishes. The configurable drain deadline defaults to 30 seconds; expiry aborts replacement and resumes the old runtime.

**Runtime Activation** completes when the intended new supervisor/runtime generation owns the scope, has loaded the validated configuration, and accepts control and client connections. Activation is distinct from service health: failed, restarting, crash-looping, or still-loading backends are reported separately and do not fail activation by themselves. Existing health checks remain health signals rather than being weakened to represent activation.

The behavioral contract is accepted and implemented for compatible background runtimes. Normal cooperative replacement must preserve ownership and context-authority protections; timeout or a public identity response alone never authorizes takeover. Existing recovery guarantees remain authoritative.
