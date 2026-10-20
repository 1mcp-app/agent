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

## Synopsis

```bash
npx -y @1mcp/agent cli-setup (--codex | --claude) [options]
```

## Description

The `cli-setup` command installs lightweight bootstrap files that point Codex or Claude at the 1MCP CLI workflow. It writes:

- A managed `1MCP.md` bootstrap document
- Managed `SessionStart` and `SubagentStart` bootstrap command hooks, plus `SessionEnd` caller cleanup
- A startup file reference from `AGENTS.md` or `CLAUDE.md`

`cli-setup` does not replace [`instructions`](./instructions.md). It makes sure the session is prepared to use `instructions`, `inspect`, and `run` in the right order.

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
2. If the provider or tool is unknown, optionally use `1mcp inspect --search <query>` (or add a server target); otherwise inspect the known target directly
3. Run `1mcp inspect <server>` and read the applicable server instructions before picking a tool
4. Run `1mcp inspect <server>/<tool>` before invocation
5. Run `1mcp run <server>/<tool> --args '<json>'` only after inspecting the schema

Search defaults to case-insensitive literal substring matching. Use a quoted `--search 'filesystem/*read?' --glob` pattern for whole-reference `*`/`?` matching. `--include-descriptions` adds effective descriptions to matching; `--show-descriptions` independently displays them.

Rerun the same `cli-setup` command to refresh managed guidance in any scope. Repeated runs are byte-stable and preserve unrelated startup-document content and hooks, including commands mixed into a managed hook entry. Exact legacy `1mcp instructions` handlers are replaced with unconditional `1mcp bootstrap --client <client> --event <event>` handlers for both events. Customized commands with extra arguments remain user-owned. Global and repository hooks may both deliver the same playbook; repeated delivery is safe and does not suppress a differently assigned worker.

## Worker Bootstrap and Project Assignment

`bootstrap` reads client hook JSON from stdin and returns `hookSpecificOutput.additionalContext` for the requested event. Both [Codex](https://developers.openai.com/codex/hooks) and [Claude](https://code.claude.com/docs/en/hooks) support this format. Hook input is limited to 64 KiB with a one-second stdin deadline. Runtime rendering has a five-second deadline. Successfully fetched instructions are delivered in full, without a subprocess output cap or context-size cutoff. Invalid input and runtime failures still deliver the general playbook with a coverage gap rather than claiming complete project instructions.

When the rendered runtime instructions exceed 9,000 characters (JavaScript string length), bootstrap appends an advisory asking the agent to briefly inform the user and recommend a 1MCP preset to select fewer relevant MCP servers in future sessions, for example `1mcp instructions --preset <name>`. The threshold excludes the static playbook and serialized assignment. All instructions and valid assignments remain intact; the agent continues the current task without automatically changing configuration. Instructions at or below the threshold receive no advisory.

A `SessionStart` handler can fetch ordinary runtime instructions. A `SubagentStart` handler without an explicit assignment delivers the inspect-before-run playbook and reports unresolved project selection. It never chooses the parent checkout from hook cwd or session identity. The supported hook schemas do not provide a worker project assignment field.

Bootstrap parses its options from explicit CLI flags rather than inherited `ONE_MCP_*` options. Its instructions subprocess excludes inherited `ONE_MCP_PROJECT` and `ONE_MCP_PROJECT_SET`; other environment plumbing remains intact. A parent's environment selectors cannot assign an otherwise unassigned worker.

Give every worker its absolute checkout path or project-set definition path in dispatch instructions. Before project-specific discovery or calls, the worker runs one of:

Replace `/private/worker-owner.json` with that worker’s own startup credential; never reuse the parent’s credential.

```bash
1mcp bootstrap --client codex --event SubagentStart --project /absolute/frontend-checkout --project-owner /private/worker-owner.json
1mcp bootstrap --client claude --event SubagentStart --project-set /absolute/feature-projects.json --project-owner /private/worker-owner.json
1mcp bootstrap --client codex --event SubagentStart --project-set /absolute/feature-projects.json --project backend --project frontend --project-owner /private/worker-owner.json
```

Without a project set, assign exactly one absolute checkout path. With `--project-set`, repeated `--project` values select ordered member labels and override the definition's optional saved `selection`. Retain the selectors on subsequent `instructions`, `inspect`, and `run` calls. A multi-project assignment requires explicit checkout selection for checkout-specific tools; coordinate separate calls for tools that accept one project. Arguments are passed to the runtime-facing instructions command without a shell. See [Project Checkouts and Sets](/guide/project-checkouts) for the definition format and backend target contracts.

## Verify Hook Delivery

Writing hook configuration does not establish that the client enabled or trusted it, that a hook executed, or that the selected runtime and checkout index are ready. Verify the client actually receives `additionalContext` for both events. Disabled, untrusted, commented configuration files that setup leaves untouched, runtime failures, and unresolved worker assignments are bootstrap coverage gaps. Resolve the reported gap before project-specific tool use. Setup does not enable hooks or change trust automatically.

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Conceptual overview of the agent-facing CLI workflow
- **[Instructions Command](./instructions.md)** - Fetch or refresh runtime guidance directly when hooks have not delivered it
- **[Inspect Command](./inspect.md)** - Discover tools and schemas
- **[Run Command](./run.md)** - Invoke a selected tool
- **[Codex Integration Guide](../guide/integrations/codex.md)** - End-to-end setup for Codex

## Preparation guidance

The managed `SessionStart` and `SubagentStart` hooks invoke `1mcp bootstrap`. Bootstrap delivers the managed playbook and, when selection is resolved, runtime instructions. The playbook teaches the [project prepare workflow](/commands/project/prepare): inspect readiness, request authorized work, monitor its job, verify readiness, refresh discovery, and make a fresh tool call. An unresolved worker assignment must be recovered before project-specific preparation.

Setup installs this guidance; it does not start preparation, enable automatic preparation, or change action permissions. Keep the bootstrap hooks. If current instructions were already delivered by hooks, do not fetch them again; otherwise use the standalone `1mcp instructions` entrypoint. Rerun `cli-setup` to refresh managed guidance in the selected scope.

Startup hooks create a private owner credential for each verified host session or worker. Retain the injected `--project-owner` file reference on every CLI call, including manual bootstrap retries with an explicit assignment. `SessionEnd` releases only that session's recorded selections within a bounded hook deadline. See [Project lifecycle](/commands/project/) for blockers, operator drain, and manager removal.

Worker terminal events are not currently supported. `SubagentStop` means a worker has stopped responding for now and can continue later; it is not verified session termination and must not release its ownership. Workers must use `1mcp project release` explicitly when finished. Idle expiry remains the fallback for missed end events and crashes.
