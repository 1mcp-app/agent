---
title: Drain a Project Checkout
description: Close admission and wait for verified checkout cleanup in one runtime.
---

# project drain

Require local operator authority, close admission for one checkout, and report whether the selected runtime has released it. Existing owners cannot start new work; previously admitted work may finish.

## Usage

```bash
1mcp project drain --project /work/frontend --wait-ms 5000 --format json
```

Select exactly one checkout. Keep the same `--context` or `--url` throughout removal. `--wait-ms` accepts 0–60000 milliseconds; omission returns the current state immediately. A timeout leaves admission closed.

## Completion and blockers

Require exit code zero and `results[0].complete: true` before treating drain as complete. Pending work, blockers, timeout, and errors return nonzero. Inspect [project status](/commands/project/status) to identify what remains.

Drain does not cancel jobs or terminate active work. Each owner must [release its bindings](/commands/project/release). Preparation jobs must finish or be deliberately cancelled through authorized [preparation controls](/commands/project/prepare). Subscriptions and shared resources can prevent completion.

On Windows, live stdio backends remain blockers when verified graceful termination is unavailable; cleanup does not fall back to forced termination. Stop those owned backends through an explicit supported operator workflow and retry drain. Static backends rooted in the checkout and unresolved preparation recovery records can also block completion.

Admission stays closed across runtime restart and deletion/recreation of the canonical checkout path. If removal is abandoned, explicitly [resume admission](/commands/project/resume).

Drain preserves prepared indexes and configuration. It does not delete the checkout or establish that other runtimes and unrelated processes have released it. Follow the [manager removal sequence](/commands/project/#manager-removal-sequence).
