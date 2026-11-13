---
title: Backend integration verification
description: Verify setup and checkout isolation, then assess preparation safety separately.
---

# Backend integration verification

Use this guide when changing backend setup or adding a preparation integration. Setup verification checks configuration and source access; preparation verification must also establish freshness, writer ownership, and cancellation behavior.

## Verify setup and checkout isolation

Install the repository dependencies and the backend executables before running the harness. Use a Serena resources directory with TypeScript and typescript-language-server already installed. The harness does not substitute for dependency installation.

From the repository root:

```bash
pnpm build
python3 -B scripts/verify-known-server-setup.py \
  --cli "$PWD/build/index.js" \
  --codegraph /absolute/bin/codegraph \
  --crg /absolute/bin/code-review-graph \
  --serena /absolute/bin/serena \
  --serena-resources /absolute/serena-home
```

The [setup harness](../../scripts/verify-known-server-setup.py) creates isolated configuration and fixture checkouts, initializes native backends explicitly, and queries them through public 1MCP interfaces. Expect each main checkout, linked worktree, and independent repository to return its own source. A query returning another checkout's symbol indicates a target-isolation failure, even if the command exits successfully.

Commands, results, and `evidence.json` are written to a new OS temporary directory. Inspect the failing command and target there before changing setup behavior. Keep run-specific versions and results with the PR or CI run. The fixture's small source files do not measure large-repository performance. Process cleanup covers owned process groups and observed descendants, not arbitrary daemonization.

## Verify a preparation integration

Start with [recipe development](backend-preparation-recipes.md) and the [native wrapper example](../../examples/backend-preparation/README.md). Use [configured preparation verification](../../scripts/verify-configured-preparation.mjs) for the wrapper workflow and its documented invocation.

Evaluate these boundaries separately:

- **Freshness:** add and modify uncommitted supported source, then verify native queries see it. A matching Git commit or a complete index status is insufficient.
- **Ownership:** hold a native writer open while attempting preparation. Admission must precede every write, including database open, schema migration, and repair.
- **Read-only inspection:** compare state before and after a warm probe, including database sidecars and configuration files.
- **Cancellation:** cancel an owned runtime job and verify attached descendants stop while foreign writers remain intact.
- **Responsiveness:** measure cold preparation and warm probes on representative source sizes, including unrelated ready tools during a shared job.

Successful action exit must be followed by a probe establishing readiness. An inconclusive probe must remain unknown; an integration-only lock cannot prove coordination with native CLI writers or watchers.

## Diagnose native limitations

Use the [graph diagnostics](preparation-native-acceptance.md) or [Serena diagnostics](preparation-serena-acceptance.md) before relying on their native status or ownership interfaces. Those scripts reproduce specific native behaviors; passing them does not certify an automatic preparation integration.
