---
title: Project Commands - Preparation and Checkout Lifecycle
description: Release caller-owned checkout bindings, inspect blockers, and explicitly drain or resume a checkout in one 1MCP runtime.
---

# Project Commands

Use `project` to manage a checkout's use by the selected 1MCP runtime. [Project preparation](/commands/project/prepare) manages backend readiness and its jobs separately.

```bash
1mcp project status --project /work/frontend --format json
1mcp project release --format json
1mcp project drain --project /work/frontend --wait-ms 5000 --format json
1mcp project resume --project /work/frontend --format json
```

In a supported Codex session, release uses your verified owner and assigned current project automatically. Otherwise supply your own bootstrap `--project-owner <absolute-file>` and, when needed, explicit project selectors. Release never assumes that callers using the same checkout are the same owner.

## Actions and authority

| Action                                 | Result                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`prepare`](/commands/project/prepare) | Inspect backend readiness and manage preparation jobs.                                                                                                                                         |
| [`status`](/commands/project/status)   | Inspect admission, ownership, active work and cleanup blockers without creating bindings, starting preparation, or extending idle lifetimes.                                                   |
| [`release`](/commands/project/release) | Release only the verified caller's selected bindings. Other sessions, sibling workers, active requests and shared backends remain protected.                                                   |
| [`drain`](/commands/project/drain)     | Require local operator authority, close admission, and report when the selected runtime has released the checkout. Existing owners cannot start new work. Previously admitted work may finish. |
| [`resume`](/commands/project/resume)   | Require operator authority and explicitly reopen admission. This does not prepare or start a backend.                                                                                          |

Credentials are scoped to the runtime and signed using verified local authority. A claimed session ID, checkout path or role is insufficient. Existing runtime authentication still applies. Remote callers cannot acquire operator authority by setting a request field.

Drain does not cancel jobs or terminate active work. Owners must release their bindings; jobs must finish or be deliberately cancelled through their authorized [preparation controls](/commands/project/prepare). Subscriptions and shared resources can prevent completion.

On Windows, live stdio backends remain blockers when verified graceful termination is unavailable; project cleanup never falls back to forced termination. Stop those owned backends through an explicit supported operator workflow and inspect again. Static backends rooted in the checkout are also shared blockers. After a runtime restart, unresolved preparation recovery records remain blockers until explicitly reconciled.

## Options and results

Lifecycle actions support `--format text|json`, `--project`, runtime `--context` or `--url`, and the usual configuration/filter options. Keep the same runtime throughout removal.

- `--project-owner <absolute-file>` selects the private credential created for this session or worker. Supported Codex sessions resolve it automatically; other hosts retain it across CLI invocations. Do not share a parent's credential with workers.
- `--wait-ms <0–60000>` is a bounded drain wait. Omission returns the current state immediately. A timeout leaves admission closed.
- `drain` and `resume` require exactly one checkout. `release` and `status` accept explicitly selected members of `--project-set` and return separate checkout results. Unresolved selection is rejected.

JSON output contains a `results` array. Each entry includes `checkoutPath`, `admission` (`open` or `draining`), `complete`, and `blockers`. `release` also reports `ownerReleased`: true proves this caller no longer needs release authority for that selection, even if other owners or shared resources remain. False or missing proof retains terminal-cleanup retry state. HTTP success or accepting a drain request does not mean cleanup is complete.

`status` exits zero after a successful inspection even when blocked. `drain` exits zero only when every selected result is complete; pending work, blockers, timeout and errors return nonzero. `release` also returns nonzero while checkout cleanup remains pending. Command errors use the CLI's structured error envelope with `--format json`.

Admission stays closed across runtime restart and deletion/recreation of the canonical checkout path. Explicit `resume` is required. Release, drain and resume can be repeated; they preserve prepared indexes and configuration.

## Manager removal sequence

1. Each session or worker releases its own selected bindings using its bootstrap credential.
2. An operator runs `project drain` for exactly one checkout in the same runtime.
3. Require exit code zero **and** `complete: true`. Otherwise inspect blockers, let admitted work finish, and repeat status/drain within a bounded budget.
4. The worktree manager checks for unrelated processes and other runtimes, then removes the checkout using its own removal command.

1MCP does not delete checkouts or artifacts, kill unrelated processes, or certify that the machine is globally free of checkout users. If removal is abandoned, run `project resume` before using this checkout again.

## Session and worker hooks

[CLI setup](/commands/cli-setup) installs startup ownership and root `SessionEnd` cleanup. Codex `CODEX_THREAD_ID` locates its exact private hook record and owner credential, including thread-only worker shells. If present, root `CODEX_SESSION_ID` must agree. Both IDs can also locate legacy credentials directly. Normal local MCP calls omit owner and project flags. The root keeps its verified startup checkout; workers require explicit dispatch assignments. Per-call project/worktree overrides never change that default. Claude and hosts without a trustworthy locator or both-ID integration retain their own `--project-owner` fallback. Unintegrated CLI calls continue to use cwd.

Verified terminal cleanup releases only recorded selections and deletes private owner state and its exact thread locator after safe release. Failed, pending, or uncertain releases preserve a terminal journal and credential. Retry only an ended owner's recorded targets with:

```bash
1mcp project recover --project-owner /private/ended-session-owner.json
```

`recover` accepts no project/runtime selectors and grants no operator authority. It requires prior verified terminal evidence and checks each recorded runtime identity. Other owners and shared resources remain protected. Records with no terminal evidence, including a live worker, are never swept by age or parent termination. Stale locks require inspection before recovery.

`Stop`, `SubagentStop`, and ordinary turn completion do not end ownership. Workers explicitly release when their assignment is finished; manual release preserves credentials for continued use. Automatic worker-terminal coverage is unavailable. Missing hooks, unsupported clients, unavailable identity variables, runtime failures, and hook deadlines remain coverage gaps. Tracking requires scoped write permission for `<config-dir>/project-owners` and its target records; a denial fails the call rather than dropping ownership. Idle expiry may release runtime bindings after crashes, but never proves terminal credential cleanup or manager removal readiness.

Event semantics: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and [Claude Code hooks](https://code.claude.com/docs/en/hooks). Installing hook configuration alone does not verify delivery in a live client.
