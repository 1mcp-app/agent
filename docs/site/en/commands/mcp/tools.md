---
title: MCP Tools Commands - Disable Individual Tools
description: List, disable, and re-enable individual tools for configured MCP servers without disabling the entire server.
head:
  - ['meta', { name: 'keywords', content: 'mcp tools,disabledTools,disable tool,enable tool,tool filtering' }]
  - ['meta', { property: 'og:title', content: '1MCP Tools Commands Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'List, disable, and re-enable individual tools for configured MCP servers.',
      },
    ]
---

# mcp tools

Manages per-server disabled tool lists.

Use this command when a server is useful overall, but one or more of its tools should be hidden from `inspect`, `run`, direct MCP clients, and lazy-loading tool flows.

## Synopsis

```bash
npx -y @1mcp/agent mcp tools
npx -y @1mcp/agent mcp tools list [server] [--disabled]
npx -y @1mcp/agent mcp tools disable <server> <tool>
npx -y @1mcp/agent mcp tools enable <server> <tool>
```

## Description

`mcp tools` opens an interactive browser with token estimates. The `list`, `disable`, and `enable` subcommands are config-only commands that update the selected server's `disabledTools` array in `mcp.json`.

If `1mcp serve` is already running, it reloads `mcp.json` changes through config hot reload. You can verify the current state with:

```bash
npx -y @1mcp/agent mcp tools list <server> --disabled
```

## Arguments

- **`[server]`**
  - Optional server name for `list`.
  - Required for `enable` and `disable`.

- **`<tool>`**
  - Exact server-local tool name to enable or disable.
  - Required for `enable` and `disable`.

## Options

- **`--server <server>`**
  - Open the interactive browser directly for one server.

- **`--model <model>`**
  - Model to use for token estimation in interactive mode.

- **`--disabled`**
  - With `list`, show disabled tool names instead of counts.

## Examples

```bash
# Open the interactive tool browser
npx -y @1mcp/agent mcp tools

# Show disabled tool counts for all servers
npx -y @1mcp/agent mcp tools list

# Show disabled tools for one server
npx -y @1mcp/agent mcp tools list filesystem --disabled

# Disable one tool without disabling the server
npx -y @1mcp/agent mcp tools disable filesystem write_file

# Re-enable the tool later
npx -y @1mcp/agent mcp tools enable filesystem write_file
```

## Configuration Behavior

Disabled tools are stored per server:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "disabledTools": ["write_file"]
    }
  }
}
```

Use logical server-local tool names such as `write_file` in `disabledTools`. Runtime filtering also recognizes qualified names like `filesystem_1mcp_write_file`, but logical names are easier to read and maintain.

When the same server name exists in both `mcpTemplates` and `mcpServers`, 1MCP treats the template entry as authoritative. `mcp tools enable` and `mcp tools disable` update `mcpTemplates.<name>.disabledTools` and leave any stale `mcpServers.<name>.disabledTools` value unchanged.

## See Also

- **[mcp enable / disable](/commands/mcp/enable-disable)** - Enable or disable an entire server
- **[mcp list](/commands/mcp/list)** - List configured servers
- **[MCP Servers Reference](/reference/mcp-servers)** - Server configuration fields
