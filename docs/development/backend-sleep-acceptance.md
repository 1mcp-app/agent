# Backend Sleep acceptance

Backend Sleep is an opt-in lifecycle for static stdio backends. The implementation preserves the Capability Catalog's visibility and routing rules while an owned backend process is absent. The [decision](../adr/0027-static-stdio-backends-can-sleep-with-explicit-opt-in.md) and [public configuration guide](https://docs.1mcp.app/guide/advanced/performance#backend-sleep) describe the operator contract.

## Reproducible verification

Run from the repository root with its configured Node and pnpm versions:

```bash
pnpm check
pnpm docs:build
pnpm test:e2e test/e2e/stdio/backend-sleep.test.ts test/e2e/stdio/backend-sleep-modern.test.ts --maxWorkers=1
pnpm --dir test/conformance/fixtures/typescript install --frozen-lockfile
uv sync --frozen --python 3.13 --project test/conformance/fixtures/python
pnpm test:protocol
```

The E2E command uses the built artifact from `pnpm check` or `pnpm build`. It owns temporary Runtime Scopes, SDK clients, subprocesses, and teardown. It never edits the user's live configuration.

## Behavioral evidence

- `backendSleep.test.ts` uses deterministic time to verify the initial idle boundary, discovery-only traffic, pending wire requests after caller cancellation, task and subscription completion, ownership blockers, uncertain release, shared startup, cancellation, and demand-driven cooldown.
- `backendSleepAdapter.test.ts` verifies cached discovery, post-wake operation-contract changes, and canceled startup callers without upstream dispatch.
- `clientManager.backend-sleep.test.ts` exercises intentional release without crash recovery, one replacement for concurrent callers, config replacement with a fresh idle window, sleep-policy removal, and removal/shutdown overtaking startup.
- Catalog tests retain discovery and pagination generation across sleep, apply current visibility and disabled-tool rules, and distinguish explicit refresh from ordinary discovery recovery.
- The built stdio journey covers direct tools and lazy meta-tools with both sleeping and default-off resident backends. It checks actual child exit, retained discovery, disabled-tool denial without wake, exactly one replacement for concurrent callers, independent cancellation, and exact upstream dispatch counts.
- The modern stdio journey requires protocol `2026-07-28` before and after wake. It accounts separately for the SDK’s temporary negotiation probe and the persistent backend session.
- An additional built journey verifies resource reads, prompt retrieval, and resource subscription notifications before and after backend replacement. A separately owned shared daemon remains responsive while its stdio wrapper exits and restarts.
- Existing CLI, health, Admin, configuration, protocol, and capability tests cover the surrounding contracts. Lifecycle diagnostics use registered events and existing privacy normalization.

## Platform and ownership limits

The real process sleep/wake journeys were verified locally on macOS. Linux and Windows process behavior is not claimed from those local runs. Unsupported or unreadable process-birth evidence blocks automatic release. A successful transport close alone is not accepted as proof of exit.

Release targets the verified child process created for the stdio connection. It does not signal a process group or claim reclamation of independent shared daemons. Hidden backend work cannot be inferred from MCP traffic; opt-in accepts that limitation and loss of process-local state after a fresh session.

Local checks, hosted CI, and runtime activation are separate results. No live configuration activation, merge, or deployment is part of this implementation.
