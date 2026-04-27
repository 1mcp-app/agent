---
title: Quick Start Guide - Agent-First 1MCP Setup in 5 Minutes
description: Start 1MCP in 5 minutes for Codex, Claude, Cursor, and similar agents. Run serve, connect cli-setup, and verify instructions, inspect, and run.
head:
  - ['meta', { name: 'keywords', content: '1MCP quick start,CLI mode,Codex,Claude,Cursor,agent setup,tutorial' }]
  - ['meta', { property: 'og:title', content: '1MCP Quick Start Guide - Agent-First 5 Minute Setup' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Get 1MCP running in 5 minutes for an agent workflow: serve, cli-setup, instructions, inspect, and run.',
      },
    ]
---

# Quick Start

This page is for AI agent users first.

By the end of this guide, you will have:

- One real upstream MCP server added to 1MCP
- A running `1mcp serve` instance
- Codex or Claude configured with `cli-setup`
- A verified `instructions -> inspect -> run` workflow

If you want direct MCP attachment, stdio compatibility, or operator docs instead, jump to [Choose another path](#choose-another-path).

## Prerequisites

- Node.js 18+
- An AI agent client such as Codex or Claude

## 5-Minute Agent Setup

### 1. Install 1MCP

```bash
npm install -g @1mcp/agent
```

### 2. Add one real upstream MCP server

Use a recognizable example so the agent can prove the workflow on something useful immediately:

```bash
1mcp mcp add context7 -- npx -y @upstash/context7-mcp
```

### 3. Start the runtime

```
1mcp serve
```

Keep that shell running. Open a second shell for the next steps.

### 4. Connect your agent with `cli-setup`

Pick one client:

```bash
1mcp cli-setup --codex
```

```bash
1mcp cli-setup --claude --scope repo --repo-root .
```

The command installs the startup files that tell the agent to use `instructions`, `inspect`, and `run` in order. See [`cli-setup`](/commands/cli-setup) for scope details.

### 5. Verify the workflow

Run the same commands your agent will use:

```bash
1mcp instructions
1mcp inspect context7
1mcp inspect context7/get-library-docs
1mcp run context7/get-library-docs --args '{"context7CompatibleLibraryID":"/mongodb/docs","topic":"aggregation pipeline"}'
```

### Success looks like this

- `instructions` explains the CLI workflow and shows the available runtime context
- `inspect context7` lists tools from the upstream server
- `inspect context7/get-library-docs` shows the tool schema before invocation
- `run ...` returns a real result from the upstream server

At that point your agent can use 1MCP through CLI mode without reading another setup page.

## Why this is the recommended path

For agent sessions, CLI mode is the narrowest path to a working setup:

- `1mcp serve` gives you one aggregated runtime behind the scenes
- `cli-setup` installs the bootstrap files for the agent
- `instructions -> inspect -> run` keeps the tool surface progressive instead of broad

## Choose another path

### Direct MCP attachment

Use this if your client already speaks MCP natively and you do not want CLI mode.

- [Serve command](/commands/serve)
- [Architecture](/reference/architecture)

### stdio compatibility

Use this if your client cannot connect to the HTTP runtime directly.

- [Proxy command](/commands/proxy)

### Runtime operators

Use these once the basic flow works and you want to manage the runtime itself:

- [Configuration](/guide/essentials/configuration)
- [Authentication](/guide/advanced/authentication)
- [Presets](/commands/preset/)

## Next Steps

- [CLI Mode guide](/guide/integrations/cli-mode) for the conceptual model
- [Add more servers](/guide/essentials/configuration) to expand the runtime
- [Enable authentication](/guide/advanced/authentication) for shared or production setups

## Common Issues

**`1mcp serve` fails to start**

- Check that Node.js 18+ is installed: `node --version`
- Re-run `1mcp mcp list` to confirm the upstream server was added

**`cli-setup` does not affect my agent**

- Make sure you picked the correct target: `--codex` or `--claude`
- For repo-scoped setup, verify you ran the command from the intended repository root

**`inspect` shows no tools**

- Confirm `1mcp serve` is still running in the first shell
- Run `1mcp instructions` again to confirm the current runtime state

**`run` fails against the upstream server**

- Re-run `1mcp inspect context7/get-library-docs` and check the required arguments
- Check the `serve` output for upstream startup errors
