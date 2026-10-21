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

For a detailed guide on server management, including registry-based installation and best practices, please see the **[Server Management Guide](/guide/essentials/server-management)**.

## Configure installed backends

### [setup](/commands/mcp/setup)

Configure CodeGraph, Code Review Graph, or Serena with a maintained example:

```bash
1mcp mcp setup --known codegraph
```

## Registry Commands

### [install](/commands/mcp/install)

Generate backend configuration from registry metadata. Use the interactive wizard to select a server.

```bash
1mcp mcp install --interactive
```

### [uninstall](/commands/mcp/uninstall)

Remove server configuration, creating a backup before the write by default.

```bash
1mcp mcp uninstall filesystem
```

### [search](/commands/mcp/search)

Search the MCP registry for available servers.

```bash
1mcp mcp search database
```

## Manual Configuration Commands

### [add](/commands/mcp/add)

Manually add a new MCP server to the configuration.

```bash
1mcp mcp add my-server --type=stdio -- node server.js
```

### [remove](/commands/mcp/remove)

Remove an MCP server from the configuration.

```bash
1mcp mcp remove my-server
```

### [update](/commands/mcp/update)

Update an existing MCP server's configuration.

```bash
1mcp mcp update my-server --tags=prod
```

### [enable / disable](/commands/mcp/enable-disable)

Enable or disable an MCP server without removing it.

```bash
1mcp mcp disable my-server
```

### [list](/commands/mcp/list)

List all configured MCP servers.

```bash
1mcp mcp list --tags=prod
```

### [status](/commands/mcp/status)

Check the status and details of configured servers.

```bash
1mcp mcp status my-server
```

### [tokens](/commands/mcp/tokens)

Estimate MCP token usage for server capabilities by connecting to servers and analyzing their tools, resources, and prompts.

```bash
1mcp mcp tokens --model=gpt-3.5-turbo --format=summary
```

### [tools](/commands/mcp/tools)

List, disable, and re-enable individual tools for a configured server without disabling the entire server.

```bash
1mcp mcp tools list filesystem --disabled
1mcp mcp tools disable filesystem write_file
```

## Runtime Operations

### [restart](/commands/mcp/restart)

Restart a static backend or one or more active instances of a template backend in the running aggregated runtime.

```bash
1mcp mcp restart my-server
```

## See Also

- **[Server Management Guide](/guide/essentials/server-management)**
- **[Registry Commands](/commands/registry/)** - Server discovery and installation
- **[App Consolidation Guide](/guide/integrations/app-consolidation)**
