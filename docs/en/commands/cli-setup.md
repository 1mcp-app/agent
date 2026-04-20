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
- Hook configuration so the startup doc is injected on session start
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
2. Run `1mcp inspect <server>` before picking a tool
3. Run `1mcp inspect <server>/<tool>` before invocation
4. Run `1mcp run <server>/<tool> --args '<json>'` only after inspecting the schema

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Conceptual overview of the agent-facing CLI workflow
- **[Instructions Command](./instructions.md)** - The bootstrap command that `cli-setup` points sessions toward
- **[Inspect Command](./inspect.md)** - Discover tools and schemas
- **[Run Command](./run.md)** - Invoke a selected tool
- **[Codex Integration Guide](../guide/integrations/codex.md)** - End-to-end setup for Codex
