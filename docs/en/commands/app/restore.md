---
title: App Restore Command - Restore Pre-Consolidation State
description: Restore applications to pre-consolidation state using backup files. Learn how to revert consolidation and restore original MCP configurations.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'app restore,consolidation restore,backup restore,application management,MCP configuration',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP App Restore Command Reference' }]
  - [
      'meta',
      { property: 'og:description', content: 'Restore applications to pre-consolidation state using backup files.' },
    ]
---

# app restore

Restores an application to its pre-consolidation state using a backup file.

For a complete overview of the consolidation and restore workflow, see the **[App Consolidation Guide](../../guide/integrations/app-consolidation)**.

## Synopsis

```bash
npx -y @1mcp/agent app restore [app-name] [options]
```

## Arguments

- **`[app-name]`**
  - The name of the application to restore. If omitted, you must use `--all` or `--backup`.

## Options

- **`--all`**
  - Restore all applications that have backups.

- **`--backup <path>`**
  - Restore from a specific backup metadata file.

- **`--list, -l`**
  - List available backups for the specified app.

- **`--yes, -y`**
  - Skip the confirmation prompt.

## Examples

```bash
# Restore the latest backup for Claude Desktop
npx -y @1mcp/agent app restore claude-desktop

# Restore all consolidated applications
npx -y @1mcp/agent app restore --all

# List available backups for Cursor
npx -y @1mcp/agent app restore cursor --list
```

## See Also

- **[App Consolidation Guide](../../guide/integrations/app-consolidation#backup-and-restore-system)**
