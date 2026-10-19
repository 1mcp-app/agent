---
title: MCP Enable/Disable Commands - Toggle Server Status
description: Enable or disable MCP servers without removing configurations. Temporarily turn servers on/off while preserving all settings.
head:
  - ['meta', { name: 'keywords', content: 'mcp enable,mcp disable,toggle server,server status,enable disable' }]
  - ['meta', { property: 'og:title', content: '1MCP Enable/Disable Commands Reference' }]
  - ['meta', { property: 'og:description', content: 'Enable or disable MCP servers without removing configurations.' }]
---

# mcp enable / disable

Enables or disables an MCP server without removing its configuration.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
npx -y @1mcp/agent mcp enable <name>
npx -y @1mcp/agent mcp disable <name>
```

## Arguments

- **`<name>`**
  - The name of the server to enable or disable.
  - **Required**: Yes

## Description

Disabling a server is a non-destructive way to temporarily remove it from the pool of available MCP servers. This is useful for maintenance or debugging without losing the server's configuration.

## Examples

```bash
# Disable a server
npx -y @1mcp/agent mcp disable my-server

# Re-enable the server later
npx -y @1mcp/agent mcp enable my-server
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
