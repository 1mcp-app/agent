---
title: Release Caller-Owned Project Bindings
description: Release your session or worker bindings without disturbing other owners.
---

# project release

Release only the verified caller's bindings for the selected checkout. Other sessions, sibling workers, active requests, subscriptions, and shared backends remain protected.

## Usage

```bash
1mcp project release --format json
```

Supported Codex sessions resolve their own existing owner and assigned startup project automatically. On Claude or hosts without a trustworthy thread locator or both-ID integration, add `--project-owner <own-file>` using your bootstrap reference; workers use their own credentials. A shared checkout path or claimed session ID does not establish ownership.

The session assignment is the default. Override one invocation with `--project`, or explicitly select members of `--project-set`. Keep the same runtime with `--context` or `--url` throughout cleanup.

## Results and next steps

Exit code zero means all selected checkout results are complete. A nonzero exit can mean that other owners, admitted work, subscriptions, or backend processes still block cleanup. Inspect `results[].complete`, `results[].ownerReleased`, and `results[].blockers`, let the remaining work finish, and repeat release when appropriate.

Release does not close admission or delete the checkout. For removal, follow the [manager removal sequence](/commands/project/#manager-removal-sequence) and have an operator [drain the checkout](/commands/project/drain).

See [session and worker hooks](/commands/project/#session-and-worker-hooks) for automatic end-cleanup coverage and limitations.

`ownerReleased: true` proves this owner is safely released; it does not prove the checkout is unused. Manual release keeps credentials for later calls. Verified root SessionEnd deletes private records only with safe release proof. If terminal cleanup failed, use `1mcp project recover --project-owner <ended-own-file>` to retry its recorded targets. Recovery requires terminal evidence and never infers termination from age, Stop, or a missing parent.

Automatic ownership applies to named or implicit local targets. An explicit `--url` (including loopback or SSH forwarding) needs an explicit `--project-owner` to attach local ownership.

Terminal cleanup closes new caller admission and waits for pending calls or open proxies before releasing authority. A crashed or uncertain caller lease requires inspection; age never clears it. Successful release is recorded before file deletion, allowing recovery to finish interrupted deletion without repeating runtime effects. Recorded canonical checkout paths can be cleaned after removal; a symlink retarget is rejected.
