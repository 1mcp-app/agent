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

For a complete overview of the consolidation workflow, supported applications, and best practices, please see the **[App Consolidation Guide](/guide/integrations/app-consolidation)**.

## Commands

### [consolidate](/commands/app/consolidate)

Consolidates MCP servers from desktop applications into 1MCP.

```bash
1mcp app consolidate claude-desktop cursor vscode
```

### [restore](/commands/app/restore)

Restores desktop applications to their pre-consolidation state.

```bash
1mcp app restore claude-desktop
```

### [list](/commands/app/list)

Lists supported desktop applications and their configuration status.

```bash
1mcp app list
```

### [discover](/commands/app/discover)

Discovers installed applications with MCP configurations.

```bash
1mcp app discover
```

### [status](/commands/app/status)

Shows the current consolidation status of your applications.

```bash
1mcp app status
```

### [backups](/commands/app/backups)

Lists and manages configuration backups.

```bash
1mcp app backups --cleanup=30
```
