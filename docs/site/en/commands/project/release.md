---
title: Release Caller-Owned Project Bindings
description: Release your session or worker bindings without disturbing other owners.
---

# project release

Release only the verified caller's bindings for the selected checkout. Other sessions, sibling workers, active requests, subscriptions, and shared backends remain protected.

## Usage

```bash
1mcp project release --project /work/frontend --project-owner /private/session-owner.json --format json
```

Replace the example owner file with the private credential reference supplied by your session's bootstrap. Keep that credential across calls; workers use their own credentials. A shared checkout path or claimed session ID does not establish ownership.

Select one checkout with `--project`, or explicitly select members of `--project-set`. Keep the same runtime with `--context` or `--url` throughout cleanup.

## Results and next steps

Exit code zero means all selected checkout results are complete. A nonzero exit can mean that other owners, admitted work, subscriptions, or backend processes still block cleanup. Inspect `results[].complete` and `results[].blockers`, let the remaining work finish, and repeat release when appropriate.

Release does not close admission or delete the checkout. For removal, follow the [manager removal sequence](/commands/project/#manager-removal-sequence) and have an operator [drain the checkout](/commands/project/drain).

See [session and worker hooks](/commands/project/#session-and-worker-hooks) for automatic end-cleanup coverage and limitations.
