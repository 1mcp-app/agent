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

Install 1MCP CLI hooks and reference files for Codex or Claude.

## Synopsis

```bash
npx -y @1mcp/agent cli-setup (--codex | --claude) [options]
```

## Description

The `cli-setup` command installs lightweight bootstrap files that point Codex or Claude at the 1MCP CLI workflow. It writes:

- A managed `1MCP.md` bootstrap document
- Managed `SessionStart` and `SubagentStart` bootstrap command hooks
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

`bootstrap` reads client hook JSON from stdin and returns `hookSpecificOutput.additionalContext` for the requested event. Both [Codex](https://developers.openai.com/codex/hooks) and [Claude](https://code.claude.com/docs/en/hooks) support this format. Hook input is limited to 64 KiB with a one-second stdin deadline. Runtime rendering has a five-second deadline, a 32 KiB output limit, and a 9,000-character context budget. Exceeding these limits delivers the general playbook with a coverage gap, rather than claiming complete project instructions.

The context budget includes the escaped assignment and recovery guidance. An assignment that cannot fit is omitted in full; bootstrap reports unresolved selection in the delivered context and asks the worker to recover the original selector from its dispatch instructions.

A `SessionStart` handler can fetch ordinary runtime instructions. A `SubagentStart` handler without an explicit assignment delivers the inspect-before-run playbook and reports unresolved project selection. It never chooses the parent checkout from hook cwd or session identity. The supported hook schemas do not provide a worker project assignment field.

Bootstrap parses its options from explicit CLI flags rather than inherited `ONE_MCP_*` options. Its instructions subprocess excludes inherited `ONE_MCP_PROJECT` and `ONE_MCP_PROJECT_SET`; other environment plumbing remains intact. A parent's environment selectors cannot assign an otherwise unassigned worker.

Give every worker its absolute checkout path or project-set definition path in dispatch instructions. Before project-specific discovery or calls, the worker runs one of:

```bash
1mcp bootstrap --client codex --event SubagentStart --project /absolute/frontend-checkout
1mcp bootstrap --client claude --event SubagentStart --project-set /absolute/feature-projects.json
1mcp bootstrap --client codex --event SubagentStart --project-set /absolute/feature-projects.json --project backend --project frontend
```

Without a project set, assign exactly one absolute checkout path. With `--project-set`, repeated `--project` values select ordered member labels and override the definition's optional saved `selection`. Retain the selectors on subsequent `instructions`, `inspect`, and `run` calls. A multi-project assignment requires explicit checkout selection for checkout-specific tools; coordinate separate calls for tools that accept one project. Arguments are passed to the runtime-facing instructions command without a shell. See [Project Checkouts and Sets](../guide/project-checkouts.md) for the definition format and backend target contracts.

## Verify Hook Delivery

Writing hook configuration does not establish that the client enabled or trusted it, that a hook executed, or that the selected runtime and checkout index are ready. Verify the client actually receives `additionalContext` for both events. Disabled, untrusted, commented configuration files that setup leaves untouched, runtime failures, and unresolved worker assignments are bootstrap coverage gaps. Resolve the reported gap before project-specific tool use. Setup does not enable hooks or change trust automatically.

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Conceptual overview of the agent-facing CLI workflow
- **[Instructions Command](./instructions.md)** - The bootstrap command that `cli-setup` points sessions toward
- **[Inspect Command](./inspect.md)** - Discover tools and schemas
- **[Run Command](./run.md)** - Invoke a selected tool
- **[Codex Integration Guide](../guide/integrations/codex.md)** - End-to-end setup for Codex
