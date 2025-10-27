---
title: MCP Remove Command - Delete Server Configuration
description: Remove MCP servers from 1MCP configuration. Completely delete server settings and remove them from the active configuration.
head:
  - ['meta', { name: 'keywords', content: 'mcp remove,delete server,remove configuration,cleanup MCP,server deletion' }]
  - ['meta', { property: 'og:title', content: '1MCP Remove Command Reference' }]
  - ['meta', { property: 'og:description', content: 'Remove MCP servers from 1MCP configuration permanently.' }]
---

# mcp remove

Removes an MCP server from the 1MCP configuration.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
npx -y @1mcp/agent mcp remove <name> [options]
```

## Arguments

- **`<name>`**
  - The name of the server to remove.
  - **Required**: Yes

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--yes, -y`**
  - Skip the confirmation prompt.

## Examples

```bash
# Remove a server
npx -y @1mcp/agent mcp remove my-server

# Remove a server without prompting for confirmation
npx -y @1mcp/agent mcp remove old-server --yes
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
