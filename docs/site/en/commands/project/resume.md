---
title: Resume Project Admission
description: Explicitly reopen a drained checkout for new work.
---

# project resume

Require local operator authority and reopen admission for one checkout. Use this when a removal is abandoned or a previously drained checkout should accept new work again.

## Usage

```bash
1mcp project resume --project /work/frontend --format json
```

Select exactly one checkout and the same runtime using `--context` or `--url`. A claimed operator role in a request does not grant authority; the runtime verifies local credentials and still applies its authentication requirements.

## Result

A successful response reports `admission: open`. Check that field to verify admission reopened. Resume does not prepare or start a backend, restore released owner bindings, or remove existing blockers.

If a backend needs preparation, follow [project prepare](/commands/project/prepare). Use [project status](/commands/project/status) for a read-only inspection. Repeating resume preserves prepared indexes and configuration.
