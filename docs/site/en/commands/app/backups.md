---
title: App Backups Command - Manage Configuration Backups
description: Manage configuration backups created during app consolidation. List, view, and manage backup files for application restore operations.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'app backups,configuration backups,backup management,consolidation backups,restore files',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP App Backups Command Reference' }]
  - [
      'meta',
      { property: 'og:description', content: 'Manage configuration backups created during app consolidation process.' },
    ]
---

# app backups

Manages the configuration backups created during the consolidation process.

For a complete overview of the backup and restore system, see the **[App Consolidation Guide](/guide/integrations/app-consolidation#backups-and-restore)**.

## Synopsis

```bash
1mcp app backups [app-name] [options]
```

## Arguments

- **`[app-name]`**
  - The application whose backups you want to manage. If omitted, it will manage backups for all apps.

## Options

- **`--cleanup <days>`**
  - Remove all backups older than the specified number of days.

- **`--verify`**
  - Verify the integrity of the backup files.

## Examples

```bash
# List all available backups
1mcp app backups

# List backups for a specific app
1mcp app backups claude-desktop

# Delete all backups older than 30 days
1mcp app backups --cleanup=30

# Verify the integrity of all backups
1mcp app backups --verify
```

## See Also

- **[App Consolidation Guide](/guide/integrations/app-consolidation#backups-and-restore)**
