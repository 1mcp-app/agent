---
title: MCP Commands Overview - Server Management
description: Complete overview of MCP server management commands. Add, remove, update, and manage MCP server configurations in 1MCP.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'MCP commands,server management,MCP configuration,server lifecycle,proxy management',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Commands - MCP Server Management' }]
  - [
      'meta',
      { property: 'og:description', content: 'Complete overview of MCP server management commands and configuration.' },
    ]
---

# MCP Commands

Manage MCP server configurations within your 1MCP instance.

These commands allow you to discover, install, configure, and manage the lifecycle of MCP servers through both manual configuration and the 1MCP registry.

For a detailed guide on server management, including registry-based installation and best practices, please see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Registry-Based Commands (Recommended)

### [install](./install)

Install MCP servers from the 1MCP registry with automatic dependency resolution and version management.

```bash
npx -y @1mcp/agent mcp install filesystem
npx -y @1mcp/agent mcp install --interactive
```

### [uninstall](./uninstall)

Safely remove MCP servers with automatic backup creation and dependency validation.

```bash
npx -y @1mcp/agent mcp uninstall filesystem
npx -y @1mcp/agent mcp uninstall test-server --force
```

### [search](./search)

Search the MCP registry for available servers.

```bash
npx -y @1mcp/agent mcp search database
npx -y @1mcp/agent mcp search --category=filesystem
```

## Manual Configuration Commands

### [add](./add)

Manually add a new MCP server to the configuration.

```bash
npx -y @1mcp/agent mcp add my-server --type=stdio --command="node server.js"
```

### [remove](./remove)

Remove an MCP server from the configuration.

```bash
npx -y @1mcp/agent mcp remove my-server
```

### [update](./update)

Update an existing MCP server's configuration.

```bash
npx -y @1mcp/agent mcp update my-server --tags=prod
```

### [enable / disable](./enable-disable)

Enable or disable an MCP server without removing it.

```bash
npx -y @1mcp/agent mcp disable my-server
```

### [list](./list)

List all configured MCP servers.

```bash
npx -y @1mcp/agent mcp list --tags=prod
```

### [status](./status)

Check the status and details of configured servers.

```bash
npx -y @1mcp/agent mcp status my-server
```

### [tokens](./tokens)

Estimate MCP token usage for server capabilities by connecting to servers and analyzing their tools, resources, and prompts.

```bash
npx -y @1mcp/agent mcp tokens --model=gpt-3.5-turbo --format=summary
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
- **[Registry Commands](../registry/)** - Server discovery and installation
- **[App Consolidation Guide](../../guide/integrations/app-consolidation)**
