---
title: MCP Status Command - Check Server Status
description: Check the status and health of configured MCP servers. View connection status, capabilities, and detailed server information.
head:
  - ['meta', { name: 'keywords', content: 'mcp status command,server status,health check,connection status' }]
  - ['meta', { property: 'og:title', content: '1MCP Status Command Reference' }]
  - [
      'meta',
      { property: 'og:description', content: 'Check MCP server status and health in 1MCP. View connection details.' },
    ]
---

# mcp status

Checks the status and details of configured MCP servers.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
npx -y @1mcp/agent mcp status [name] [options]
```

## Arguments

- **`[name]`**
  - The name of a specific server to check. If omitted, checks all servers.

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--verbose, -v`**
  - Show detailed configuration and each active template instance. Without this option, template status is aggregated by state.

## Description

This command combines configured target information with live facts from the selected aggregated runtime. It reports `connected`, `restarting`, and `crash-loop` supervision state, restart attempt and limit, next retry, last exit and error, and the current child PID when available.

Both `mcpServers` and `mcpTemplates` are included. All-server output groups runtime snapshots by declared template name even though individual instances have separate runtime keys. A named template is summarized by active-instance count and state unless `--verbose` is used, in which case each 12-character instance ID and its supervision facts are shown.

Runtime lookup uses the current Runtime Target Context. If no runtime is discoverable, configuration status still succeeds and runtime state is shown as unknown.

## Examples

```bash
# Check the status of all servers
npx -y @1mcp/agent mcp status

# Check the status of a specific server
npx -y @1mcp/agent mcp status my-server

# Get detailed status information
npx -y @1mcp/agent mcp status --verbose

# Inspect each active instance of one template
npx -y @1mcp/agent mcp status github --verbose
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
