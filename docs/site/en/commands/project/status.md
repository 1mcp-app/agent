---
title: Inspect Project Lifecycle Status
description: Inspect checkout admission and cleanup blockers in the selected runtime.
---

# project status

Inspect admission, ownership, active work, and cleanup blockers without creating bindings, starting preparation, or extending idle lifetimes.

## Usage

```bash
1mcp project status --project /work/frontend --format json
```

Use `--project` for a checkout, or explicitly select members of `--project-set`. Use the same `--context` or `--url` as the runtime whose resources you are inspecting. Both `--format text` and `--format json` are supported.

## Reading the result

JSON output contains a `results` array with one entry per checkout:

| Field          | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `checkoutPath` | Canonical checkout path.                                            |
| `admission`    | `open` accepts new work; `draining` keeps admission closed.         |
| `complete`     | Whether checkout cleanup is complete in this runtime.               |
| `blockers`     | Ownership, active work, or resources that still prevent completion. |

A successful inspection exits zero even when `complete` is false. Do not treat that exit code as removal readiness. Follow the [manager removal sequence](/commands/project/#manager-removal-sequence) before deleting a checkout.

Use [project prepare status](/commands/project/prepare) to inspect a preparation job. To change checkout admission, use [drain](/commands/project/drain) or [resume](/commands/project/resume).
