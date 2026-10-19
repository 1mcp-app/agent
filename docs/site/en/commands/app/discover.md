---
title: App Discover Command - Find MCP Applications
description: Discover installed desktop applications with MCP configurations. Scan your system for supported applications and detect MCP server setups.
head:
  - ['meta', { name: 'keywords', content: 'app discover,find applications,detect MCP,system scan,desktop discovery' }]
  - ['meta', { property: 'og:title', content: '1MCP App Discover Command Reference' }]
  - [
      'meta',
      { property: 'og:description', content: 'Discover installed desktop applications with MCP configurations.' },
    ]
---

# app discover

Discovers installed desktop applications that have MCP configurations.

This command scans your system for supported applications and reports which ones have detectable MCP server configurations.

For a complete overview of the consolidation workflow, see the **[App Consolidation Guide](../../guide/integrations/app-consolidation)**.

## Synopsis

```bash
npx -y @1mcp/agent app discover [options]
```

## Options

- **`--show-empty`**
  - Include supported applications that were found but have no MCP servers configured.

- **`--show-paths`**
  - Display the file paths of the discovered configuration files.

## Examples

```bash
# Discover all installed apps with MCP configurations
npx -y @1mcp/agent app discover

# Include apps that have config files but no servers
npx -y @1mcp/agent app discover --show-empty
```

## See Also

- **[App Consolidation Guide](../../guide/integrations/app-consolidation#the-consolidation-workflow)**
