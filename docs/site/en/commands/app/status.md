---
title: App Status Command - Check Consolidation Status
description: Check consolidation status of desktop applications. See whether apps connect directly to MCP servers or through 1MCP instance.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'app status,consolidation status,application status,MCP connections,desktop applications',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP App Status Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Check consolidation status of desktop applications and MCP connections.',
      },
    ]
---

# app status

Shows the current consolidation status of your desktop applications.

This command checks whether an application is configured to connect directly to its own MCP servers or to a central 1MCP instance.

For a complete overview of the consolidation workflow, see the **[App Consolidation Guide](../../guide/integrations/app-consolidation)**.

## Synopsis

```bash
npx -y @1mcp/agent app status [app-name] [options]
```

## Arguments

- **`[app-name]`**
  - The application to check. If omitted, it will show the status for all supported apps.

## Options

- **Environment Variable `ONE_MCP_LOG_LEVEL=debug`**
  - Set `ONE_MCP_LOG_LEVEL=debug` to show detailed configuration and backup information.

## Examples

```bash
# Show the status of all applications
npx -y @1mcp/agent app status

# Show the status for a specific app
npx -y @1mcp/agent app status claude-desktop

# Show detailed status information
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent app status
```

## See Also

- **[App Consolidation Guide](../../guide/integrations/app-consolidation#the-consolidation-workflow)**
