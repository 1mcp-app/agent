---
title: CLI Mode - Progressive Tool Access for AI Agents
description: Learn why 1MCP CLI mode is the preferred workflow for Codex, Claude, and other AI agents that need lower-context, progressive tool access.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: '1MCP CLI mode,progressive disclosure,agent workflow,Codex,Claude,token efficiency',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP CLI Mode Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Use 1MCP CLI mode to replace direct MCP attachment inside the agent loop with progressive server discovery, tool inspection, and execution.',
      },
    ]
---

# CLI Mode

CLI mode is the preferred 1MCP workflow for AI agents such as Codex and Claude.

It does **not** replace MCP as a protocol. 1MCP still runs your MCP servers behind `1mcp serve`. What changes is the interface the agent sees during its own loop: instead of carrying a broad MCP tool surface directly in context, the agent discovers only what it needs, when it needs it.

For a given agent, CLI mode should not live alongside direct MCP configuration. Choose one mode only. When you switch an agent to CLI mode, remove that agent's existing MCP server configuration first.

## Why CLI Mode Exists

Direct MCP attachment is great for interoperability, but agent sessions pay for that convenience with context:

- Large tool catalogs are exposed up front
- Tool schemas can be verbose
- Repeated discovery and tool output increase prompt size over long sessions

That matters because agent loops are context-bound. OpenAI's Codex docs explicitly call out prompt growth and context compaction pressure in long-running sessions, and Claude Code documents both dynamic MCP tool refresh and warnings for large MCP outputs.

CLI mode changes the agent-facing pattern from:

- "load the whole tool surface into the session"

to:

- "show me the current inventory"
- "zoom into one server"
- "inspect one tool"
- "run exactly that tool"

This is progressive disclosure for tools.

## How 1MCP CLI Mode Works

Keep your MCP servers exactly where they belong: behind `1mcp serve`.

Then let the agent work through the CLI:

```bash
1mcp instructions
1mcp inspect <server>
1mcp inspect <server>/<tool>
1mcp run <server>/<tool> --args '<json>'
```

Each step narrows the context:

- `instructions` gives the playbook plus the current server inventory
- `inspect <server>` lists only one server's tools
- `inspect <server>/<tool>` shows only one tool's schema
- `run` executes only the selected tool call

From the user's perspective, the main command to run is `1mcp cli-setup`. The `instructions`, `inspect`, and `run` commands are primarily designed to be run by the AI agent after bootstrap, although the user can run them manually to test the flow.

## MCP Backend, CLI Frontend

The clean mental model is:

- MCP is the backend interoperability layer
- `serve` is the aggregated runtime
- CLI mode is the frontend workflow for agents

Under the hood, this still maps naturally to MCP primitives such as `tools/list` and `tools/call`. 1MCP is not inventing a new tool protocol. It is giving agents a more selective way to discover and use the existing one.

## Natural Migration from Direct MCP

If you already use MCP directly in an agent, the migration should feel natural:

1. Keep your existing MCP servers.
2. Move them behind 1MCP with your current config or `1mcp mcp add ...`.
3. Remove that agent's existing direct MCP server configuration.
4. Start `1mcp serve`.
5. Run `1mcp cli-setup --codex` or `1mcp cli-setup --claude`.
6. Let the agent use `instructions`, `inspect`, and `run` instead of carrying the full MCP surface directly.

That is the key point: you are not rewriting your server ecosystem. You are changing how the agent approaches it.

## Choose Only One Mode

For each agent, pick exactly one of these:

- Direct MCP mode: the agent connects to MCP servers directly
- CLI mode: the agent does not keep direct MCP server config and uses the 1MCP CLI workflow instead

We recommend CLI mode for AI agents because it gives the agent a thinner, more selective working surface.

## Recommended Bootstrap

What the user should run once per machine or repository:

```bash
1mcp cli-setup --codex
1mcp cli-setup --claude --scope repo --repo-root .
```

This installs the bootstrap docs and hooks that teach the agent to start with `instructions`. It complements the live `instructions` command; it does not replace it.

After bootstrap, these are the commands the AI agent will normally run:

```bash
1mcp instructions
1mcp inspect filesystem
1mcp inspect filesystem/read_file
1mcp run filesystem/read_file --args '{"path":"./mcp.json"}'
```

You can run them yourself to verify the setup, but the intended pattern is: user runs `cli-setup`, agent runs the workflow commands.

## When to Use CLI Mode

Prefer CLI mode when:

- The client is an autonomous or semi-autonomous coding agent
- You want tighter control over tool discovery
- You want less schema and tool noise in long sessions
- You want a repeatable, scriptable workflow across machines and teams

Direct MCP exposure still makes sense for MCP-native clients that are intentionally designed to speak MCP end-to-end. But for agent sessions, CLI mode is the default better path, and it should replace direct MCP config for that agent rather than sit beside it.

## References

- [Model Context Protocol schema reference: `tools/list` and `tools/call`](https://modelcontextprotocol.io/specification/draft/schema)
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- [OpenAI: Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)

## See Also

- [Codex Integration](./codex.md)
- [Developer Tools](./developer-tools.md)
- [Instructions Command](/commands/instructions.md)
- [Inspect Command](/commands/inspect.md)
- [Run Command](/commands/run.md)
