# Cooperative runtime upgrade implementation

The accepted behavioral contract is [ADR 0018](../adr/0018-cooperative-runtime-upgrade.md). `serve --restart` activates the invoking installation; it does not install packages or transfer sessions.

## Ownership and control

`cooperativeRuntime.ts` coordinates strict preflight, authenticated prepare/commit, old-worker retirement and a fresh exclusive scope claim. `runtimeControl.ts` binds fresh challenge/HMAC proofs to the canonical scope, protocol, owner generation, operation, method and payload. Credentials remain in owner-only generation files; metadata locates the endpoint but never authenticates it. Reads do not repair permissions or delete stale metadata.

Private parent/child IPC carries frozen bootstrap input and activation acknowledgements. Worker authorization checks both the claimed generation and the kernel parent PID. Normal cooperative launch, attachment, status, stop and replacement do not capture OS process identity. Cooperative records never authorize stale-owner reclamation. Foreground and older records retain conservative explicit recovery.

## Configuration and draining

Explicit CLI/environment inputs are captured without parser defaults. Preflight validates the current JSON/TOML configuration and launch inputs before mutation, freezes configuration and environment, and hashes the snapshot. Workers install that snapshot before managers initialize. Cooperative listener startup is independent of backend loading, including when the explicit async-loading option is false; its saved provenance and notification policy remain unchanged. File reload resumes after both activation is recorded and initial backend construction settles. The parent environment remains the launch baseline for deferred or recreated transports.

`runtimeAdmission` counts root work and nested work until the dispatched promises settle. Shared gateway, legacy and REST dispatch and configuration mutations participate. Existing interaction replies, progress and cancellation remain available. The supervisor owns the configurable deadline (30 seconds by default), operation identity, duplicate handling and commit decision. Expiry resumes admission even after work reaches zero. Worker exit invalidates reversible preparation. Commit requires the matching digest, closed admission, zero active work and a worker acknowledgement.

Retirement observes the tracked worker closing before closing control and releasing the matching ownership record. A response or timeout is never evidence of release. Successor startup uses a non-reclaiming exclusive claim. Failure after retirement requires explicit retry; there is no rollback or tool replay.

## Verification boundaries

Focused unit tests cover authenticated control, forged/replayed/stale messages, deadlines, duplicate/late commits, work accounting, provenance and frozen child bootstrap. The cooperative lifecycle E2E suite uses isolated real CLI/supervisor/worker processes and a synthetic earlier compatible installation fixture. A synthetic fixture does not establish compatibility with an independently released version.

The `Cooperative runtime` workflow runs the same real-process suite on Linux, macOS and Windows, sequentially for Node and packaged SEA distributions. Hosted results and a released earlier compatible protocol fixture are release evidence; adding the workflow is not evidence that its jobs passed. Unsupported or unexecuted matrix cells must remain explicit in the PR and release assessment.
