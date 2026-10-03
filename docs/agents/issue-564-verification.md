# Issue #564 verification boundaries

The implementation starts from `ce0a69590519a065a5536b514b0a107c65659305`, which contains the merged compile-verdict cache optimization from #582. Individual upstream admission timeout isolation is a separate contract: keep healthy tools available, withhold timed-out tools from listing and invocation, and return partial discovery metadata. Shared validator and runtime-owned tool failures remain fatal.

## Windows identity diagnosis

Automatic proxy attachment first attempts authenticated cooperative runtime control. If that is unavailable, legacy discovery checks process birth evidence in `server.pid`. Cooperative owner evidence is stored separately in `runtime.owner/owner.json`. Removing identity only from the owner record does not demonstrate that PID-file verification was bypassed, and authenticated control attachment has its own ownership proof.

Windows acquisition failures now log only platform, lookup PID, elapsed milliseconds, and a bounded error category. `ETIMEDOUT`, missing tools, permission errors, and malformed evidence can therefore be distinguished without exposing subprocess stderr. Acquisition methods and the 3000ms subprocess deadlines are unchanged. Missing or unreadable birth evidence remains unknown; it never becomes a PID-only match. Recovery messages perform an existing diagnostic re-read, so their details describe that lookup rather than proving the reason for an earlier failure.

The reporter's antivirus explanation and timeout attribution remain unverified. To reconcile a failed experiment, capture sanitized before/after `server.pid`, `runtime.owner/owner.json`, and the presence of `runtime-control.json`, together with the actual attachment path and acquisition diagnostics. Keep scope identity in `runtime-identity.json` distinct from process birth evidence.

## Outstanding Windows acceptance

This development environment is macOS. Injected Windows tests and macOS checks do not establish Windows runtime acceptance. Neither the reporter's triggering schemas nor a Windows test host is available here. Do not close #564 as fully verified based on this PR.

On the exact PR revision, test both npm and Windows SEA artifacts in isolated configuration scopes and ports. Record artifact hashes, revision, Windows/Node versions, and sanitized configuration. Exercise cold runtime launch, automatic proxy attachment, and explicit URL attachment with a real MCP initialize exchange. Run the reporter's 13-upstream configuration with `lazyLoading.mode="metatool"` and `asyncLoading.minServers=20`, including five concurrent attachments during startup. Keep identity failures separate from schema admission failures and distinguish fresh scopes from historical missing metadata.

For a triggering schema fixture, confirm healthy tools can be listed and called, timed-out tools cannot execute, all-timeout results are explicitly partial, continuation pages retain partial status, and a new first-page listing or capability refresh can recover. Compare results with the historical beta.0 artifact when available; an empty-server or warm-runtime success does not cover the startup-burst scenario.
