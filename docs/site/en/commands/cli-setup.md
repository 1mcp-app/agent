---
title: CLI Setup Command - Install Bootstrap Files for Codex and Claude
description: Use the cli-setup command to install 1MCP startup docs and hooks for Codex or Claude in global or repo scope.
head:
  - ['meta', { name: 'keywords', content: '1MCP cli-setup command,Codex hooks,Claude hooks,startup docs' }]
  - ['meta', { property: 'og:title', content: '1MCP CLI Setup Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Install bootstrap startup docs and hook configuration for Codex or Claude.',
      },
    ]
---

# CLI Setup Command

Client hooks run `bootstrap` to establish ownership and fetch guidance through `instructions`. Agents run `instructions` separately only when current guidance is missing or needs refreshing; it does not create an owner credential. See [the startup workflow](/guide/worktrees-and-cross-project-sessions#bootstrap-and-instructions-which-one-runs).

For a complete setup-to-cleanup walkthrough, see [Working Across Projects and Worktrees](/guide/worktrees-and-cross-project-sessions).

Install 1MCP CLI hooks and reference files for Codex or Claude.

Reuse known tool schemas within the session, including across projects, when the tool contract is unchanged. Keep project-specific instructions, readiness, authorization, and target selection current. Refresh server and tool inspection when information is missing, capabilities change, preparation completes, or relevant failures occur. Never automatically replay failed tool calls.

## Synopsis

```bash
npx -y @1mcp/agent cli-setup (--codex | --claude) [options]
```

## Description

The `cli-setup` command installs lightweight bootstrap files that point Codex or Claude at the 1MCP CLI workflow. It writes:

- A managed `1MCP.md` bootstrap document
- Managed `SessionStart` and `SubagentStart` bootstrap command hooks, plus `SessionEnd` caller cleanup
- A startup file reference from `AGENTS.md` or `CLAUDE.md`
- The `1mcp-preparation-setup` skill and its backend references

`cli-setup` does not replace [`instructions`](/commands/instructions). It makes sure the session is prepared to use `instructions`, `inspect`, and `run` in the right order.

Think of `cli-setup` as the bridge from an existing agent workflow to 1MCP CLI mode. It teaches the client how to start, but the live discovery and execution flow still happens through `instructions`, `inspect`, and `run`.

## Required Client Selection

Choose exactly one target:

- **`--codex`** - Install setup files for Codex only
- **`--claude`** - Install setup files for Claude only

Passing neither or both returns an error.

## Options

- **`--scope <global|repo|all>`** - Setup scope (default: `global`)
- **`--repo-root <path>`** - Repository root used for repo-scoped setup

## Scope Behavior

- **`global`** - Writes into the user's home-level Codex or Claude directories
- **`repo`** - Writes repo-local setup files under the selected repository root
- **`all`** - Writes both global and repo-scoped setup files

## Files Written

### Codex

- Global managed doc: `~/.codex/1MCP.md`
- Global hooks: `~/.codex/hooks.json`
- Global startup reference: `~/.codex/AGENTS.md`
- Repo managed doc: `<repo>/.codex/1MCP.md`
- Repo hooks: `<repo>/.codex/hooks.json`
- Repo startup reference: `<repo>/AGENTS.md`

### Claude

- Global managed doc: `~/.claude/1MCP.md`
- Global hooks: `~/.claude/settings.json`
- Global startup reference: `~/.claude/CLAUDE.md`
- Repo managed doc: `<repo>/.claude/1MCP.md`
- Repo hooks: `<repo>/.claude/settings.json`
- Repo startup reference: `<repo>/CLAUDE.md`

## Preparation setup skill

Every `cli-setup` invocation installs the preparation skill in the selected client and scope:

| Client | Global                                     | Repository                                      |
| ------ | ------------------------------------------ | ----------------------------------------------- |
| Codex  | `~/.agents/skills/1mcp-preparation-setup/` | `<repo>/.agents/skills/1mcp-preparation-setup/` |
| Claude | `~/.claude/skills/1mcp-preparation-setup/` | `<repo>/.claude/skills/1mcp-preparation-setup/` |

Codex uses the shared `.agents/skills` directory in both scopes, so other agents that discover skills there can read the same installation. Claude keeps its native `.claude/skills` directory. Existing copies under `.codex/skills` are left untouched; if you installed an earlier preview, review and remove that duplicate manually after confirming the shared skill is discovered.

Ask your agent to “Use the 1mcp-preparation-setup skill to configure preparation for my CodeGraph worktree.” The skill is also available for automatic selection when you ask to configure backend preparation. It can reuse supplied recipes or help author and verify a missing recipe. It includes version-sensitive guidance for CodeGraph, Code Review Graph, and Serena; these are not bundled production recipes.

Installation works offline from an installed npm package or standalone binary. It does not enable preparation, install backend dependencies, or change `mcp.json`. See [Backend preparation](/guide/backend-preparation) for activation and verification.

Rerun `cli-setup` to refresh the skill. Output reports `installed`, `updated`, `unchanged`, or `conflict`. A skill-local `.1mcp-managed.json` records managed file hashes. Unchanged managed files can be updated; local edits, removed managed files, unknown same-name installations, and symlink destinations are preserved and reported as conflicts. Other setup files still complete. To resolve a conflict, retain your custom skill separately and move the conflicting skill directory out of the install location before rerunning setup. Unrelated files are preserved.

An installation lock prevents concurrent writers. Interrupted upgrades retain a journal and can resume without treating installer-written bytes as local edits. A missing newly added file in that journal is reported as a conflict: setup cannot tell an interrupted write from a user deletion, so it preserves the missing file. If a terminated process leaves an `.install-lock` directory beside the skill, confirm that no installer is running before moving that lock aside and rerunning setup. Never remove an active installer’s lock.

## Examples

### Install Global Codex Setup

```bash
npx -y @1mcp/agent cli-setup --codex
```

### Install Repo-Local Claude Setup

```bash
npx -y @1mcp/agent cli-setup --claude --scope repo --repo-root .
```

### Install Both Global and Repo-Local Codex Setup

```bash
npx -y @1mcp/agent cli-setup --codex --scope all
```

## Codex Follow-Up

When `--codex` is used, the command also prints a required `config.toml` snippet enabling Codex hooks and the workspace-write sandbox with network access.

## Resulting Workflow

The managed startup docs tell the client to:

1. Run `1mcp instructions` unless the current session already received those instructions from hooks
2. If the provider or tool is unknown, optionally use `1mcp inspect --search <query>` (or add a server target); skip discovery when the target is already known
3. Run `1mcp inspect <server>` when its inventory or instructions are missing; read the applicable server instructions
4. Run `1mcp inspect <server>/<tool>` when the schema is not already known
5. Run `1mcp run <server>/<tool> --args '<json>'` using the known schema

Search defaults to case-insensitive literal substring matching. Use a quoted `--search 'filesystem/*read?' --glob` pattern for whole-reference `*`/`?` matching. `--include-descriptions` adds effective descriptions to matching; `--show-descriptions` independently displays them.

Rerun the same `cli-setup` command to refresh managed guidance in any scope. Repeated runs are byte-stable and preserve unrelated startup-document content and hooks, including commands mixed into a managed hook entry. Exact legacy `1mcp instructions` handlers are replaced with unconditional `1mcp bootstrap --client <client> --event <event>` handlers for both events. Customized commands with extra arguments remain user-owned. Global and repository hooks may both deliver the same playbook; repeated delivery is safe and does not suppress a differently assigned worker.

## Worker Bootstrap and Project Assignment

`bootstrap` reads client hook JSON from stdin and returns `hookSpecificOutput.additionalContext` for the requested event. Both [Codex](https://learn.chatgpt.com/docs/hooks) and [Claude](https://code.claude.com/docs/en/hooks) support this format. Hook input is limited to 64 KiB with a one-second stdin deadline. Runtime rendering has a five-second deadline. Successfully fetched instructions are delivered in full, without a subprocess output cap or context-size cutoff. Invalid input and runtime failures still deliver the general playbook with a coverage gap rather than claiming complete project instructions.

When the rendered runtime instructions exceed 9,000 characters (JavaScript string length), bootstrap appends an advisory asking the agent to briefly inform the user and recommend a 1MCP preset to select fewer relevant MCP servers in future sessions, for example `1mcp instructions --preset <name>`. The threshold excludes the static playbook and serialized assignment. All instructions and valid assignments remain intact; the agent continues the current task without automatically changing configuration. Instructions at or below the threshold receive no advisory.

A `SessionStart` handler can fetch ordinary runtime instructions. A `SubagentStart` handler without an explicit assignment delivers the inspect-before-run playbook and reports unresolved project selection. It never chooses the parent checkout from hook cwd or session identity. The supported hook schemas do not provide a worker project assignment field.

Bootstrap parses its options from explicit CLI flags rather than inherited `ONE_MCP_*` options. Its instructions subprocess excludes inherited `ONE_MCP_PROJECT` and `ONE_MCP_PROJECT_SET`; other environment plumbing remains intact. A parent's environment selectors cannot assign an otherwise unassigned worker.

Give every worker its absolute checkout path or project-set definition path in dispatch instructions. Before project-specific discovery or calls, the worker runs one of:

For the Claude example, replace `/private/your-worker-owner.json` with that worker’s own startup credential; never reuse the parent’s credential.

```bash
1mcp bootstrap --client codex --event SubagentStart --project /absolute/frontend-checkout
1mcp bootstrap --client claude --event SubagentStart --project-owner /private/your-worker-owner.json --project-set /absolute/feature-projects.json --project backend
1mcp bootstrap --client codex --event SubagentStart --project-set /absolute/feature-projects.json --project backend --project frontend
```

Without a project set, assign exactly one absolute checkout path. With `--project-set`, repeated `--project` values select ordered member labels and override the definition's optional saved `selection`. On supported Codex hosts the manual retry resolves the existing private thread locator without an owner flag. Bootstrap records the worker assignment as its default. Subsequent `instructions`, `inspect`, and `run` calls can omit project selectors. A per-call override does not change the default. A multi-project assignment requires explicit checkout selection for checkout-specific tools; coordinate separate calls for tools that accept one project. Arguments are passed to the runtime-facing instructions command without a shell. See [Project Checkouts and Sets](/guide/project-checkouts) for the definition format and backend target contracts.

## Verify Hook Delivery

Writing hook configuration does not establish that the client enabled or trusted it, that a hook executed, or that the selected runtime and checkout index are ready. Verify the client actually receives `additionalContext` for both events. Disabled, untrusted, commented configuration files that setup leaves untouched, runtime failures, and unresolved worker assignments are bootstrap coverage gaps. Resolve the reported gap before project-specific tool use. Setup does not enable hooks or change trust automatically.

## See Also

- **[CLI Mode Guide](/guide/integrations/cli-mode)** - Conceptual overview of the agent-facing CLI workflow
- **[Instructions Command](/commands/instructions)** - Fetch or refresh runtime guidance directly when hooks have not delivered it
- **[Inspect Command](/commands/inspect)** - Discover tools and schemas
- **[Run Command](/commands/run)** - Invoke a selected tool
- **[Codex Integration Guide](/guide/integrations/codex)** - End-to-end setup for Codex

## Preparation guidance

The managed `SessionStart` and `SubagentStart` hooks invoke `1mcp bootstrap`. Bootstrap delivers the managed playbook and, when selection is resolved, runtime instructions. The playbook teaches the [project prepare workflow](/commands/project/prepare): inspect readiness, request authorized work, monitor its job, verify readiness, refresh discovery, and make a fresh tool call. An unresolved worker assignment must be recovered before project-specific preparation.

Setup installs this guidance; it does not start preparation, enable automatic preparation, or change action permissions. Keep the bootstrap hooks. If current instructions were already delivered by hooks, do not fetch them again; otherwise use the standalone `1mcp instructions` entrypoint. Rerun `cli-setup` to refresh managed guidance in the selected scope.

## Session defaults and cleanup

Startup hooks create a separate private credential for each verified session and worker. Codex hooks write an exact private thread locator. Later calls use `CODEX_THREAD_ID` (current agent) to find that record and its existing credential, including workers whose shell lacks `CODEX_SESSION_ID`. When present, `CODEX_SESSION_ID` (root session) must agree with the hook record. Hosts supplying both IDs can also resolve existing legacy credentials directly. Normal calls need neither `--project-owner` nor `--project`:

```bash
1mcp instructions
1mcp inspect <server>
1mcp inspect <server>/<tool>
1mcp run <server>/<tool> --args '{}'
```

The root session keeps the startup project resolved from hook cwd or explicit startup selectors. A worker keeps its explicit dispatch assignment. Changing shell cwd or using a per-call `--project /another/worktree` does not change the session default. Without host integration, ordinary CLI calls continue to use cwd. An assigned project set retains ambiguity until you select a member with `--project <label>`; selecting members does not broaden their tool visibility.

Claude and Codex hosts without a trustworthy thread locator or both-ID integration require the hook-provided `--project-owner <own-file>` on subsequent calls and manual bootstrap retries. Replace `/private/your-worker-owner.json` above with your own hook-provided reference. Never pass a parent's credential to a worker or manufacture hook identity. Without an existing credential, resolve the trusted hook delivery gap first. Environment identifiers locate credentials; they never create them or authorize remote lifecycle control. Keep the same config directory that issued the credential, or use its explicit owner reference when selecting another local runtime scope.

New sessions write private credentials, assignments, locks, and release records beneath `<os-temp>/1mcp-owners-<user-and-config-hash>/project-owners`. The OS temporary directory comes from Node.js `os.tmpdir()`; hooks and CLI calls must use the same temporary directory and config directory. Directories are owner-only (`0700`) and credential files are `0600`. Runtime configuration stays in its original location. Existing sessions retain their original `<config-dir>/project-owners` records until verified cleanup; do not copy or move live credentials. Start a new session with the updated CLI to use temporary storage. Temporary records may be lost during OS cleanup or reboot; missing records do not prove runtime release. Permission errors and partial or conflicting records fail closed. With no hook records at all, ordinary calls use cwd and print an ownership coverage-gap diagnostic. Setup does not widen sandbox permissions.

Verified root `SessionEnd` releases only that owner's recorded selections. Once every target reports the owner safely released, cleanup removes its credential, thread locator, assignment, selection snapshots, and target records. Other owners and shared resources remain protected. Repeated terminal cleanup is safe. A pending or uncertain release retains the credential and terminal journal for a bounded retry:

```bash
1mcp project recover --project-owner /private/ended-session-owner.json
```

Recovery uses only recorded targets and verifies their runtime identity. It requires a prior verified terminal record; age alone, a missing parent, and `Stop` or `SubagentStop` never establish inactivity. Records from crashes before a terminal hook remain for inspection rather than being swept. An abandoned lock also requires inspection; do not delete a live process's lock.

Worker terminal events are not currently supported. `SubagentStop` means a worker may continue later. Workers explicitly use `1mcp project release` when finished; manual release keeps credentials for continued use. Ordinary turn completion never releases or deletes active owner state. Missing hooks, unsupported clients, hook deadlines, or permission failures remain explicit coverage gaps. See [Project lifecycle](/commands/project/) for release results, blockers, and manager removal.
