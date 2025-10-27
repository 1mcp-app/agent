---
title: App Commands Overview - Desktop Application Consolidation
description: Complete overview of app consolidation commands. Manage desktop application MCP configurations and consolidate them into unified 1MCP proxy.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'app commands,application consolidation,desktop apps,MCP configuration,app management',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP App Commands - Application Consolidation' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete overview of app consolidation commands for desktop applications.',
      },
    ]
---

# App Commands

The `app` command group helps you consolidate MCP server configurations from various desktop applications into a unified 1MCP proxy.

For a complete overview of the consolidation workflow, supported applications, and best practices, please see the **[App Consolidation Guide](../../guide/integrations/app-consolidation)**.

## Commands

### [consolidate](./consolidate)

Consolidates MCP servers from desktop applications into 1MCP.

```bash
npx -y @1mcp/agent app consolidate claude-desktop cursor vscode
```

### [restore](./restore)

Restores desktop applications to their pre-consolidation state.

```bash
npx -y @1mcp/agent app restore claude-desktop
```

### [list](./list)

Lists supported desktop applications and their configuration status.

```bash
npx -y @1mcp/agent app list
```

### [discover](./discover)

Discovers installed applications with MCP configurations.

```bash
npx -y @1mcp/agent app discover
```

### [status](./status)

Shows the current consolidation status of your applications.

```bash
npx -y @1mcp/agent app status
```

### [backups](./backups)

Lists and manages configuration backups.

```bash
npx -y @1mcp/agent app backups --cleanup=30
```
