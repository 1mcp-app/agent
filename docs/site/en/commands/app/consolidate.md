---
title: App Consolidate Command - Unify Desktop App Configs
description: Consolidate MCP server configurations from Claude Desktop, Cursor, and other desktop apps into a single 1MCP instance.
head:
  - ['meta', { name: 'keywords', content: 'app consolidate command,desktop apps,config consolidation,Claude Desktop' }]
  - ['meta', { property: 'og:title', content: '1MCP App Consolidate Command' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Consolidate desktop app MCP configurations into 1MCP. Supported applications and workflow.',
      },
    ]
---

# app consolidate

Consolidates MCP servers from desktop applications into 1MCP.

This command extracts MCP server configurations from an application's config file, imports them into your 1MCP configuration, and replaces the app's config with a single connection to your 1MCP server.

For a complete overview of the consolidation workflow, supported applications, and best practices, see the **[App Consolidation Guide](/guide/integrations/app-consolidation)**.

## Synopsis

```bash
1mcp app consolidate <app-name...> [options]
```

## Arguments

- **`<app-name...>`**
  - One or more desktop applications to consolidate.
  - **Required**: Yes
  - To see a list of supported applications, use `1mcp app list` or refer to the [App Consolidation Guide](/guide/integrations/app-consolidation#supported-applications).

## Options

### Connection Options

- **`--url, -u <url>`** - Override the auto-detected 1MCP server URL.

### Operation Options

- **`--dry-run`** - Preview all changes without modifying any files.
- **`--yes, -y`** - Skip all confirmation prompts.
- **`--force, -f`** - Skip non-critical validation warnings.

### Mode Options

- **`--manual-only`** - Show manual setup instructions instead of performing automatic consolidation.
- **`--backup-only`** - Create a backup of the existing configuration without importing servers or modifying the config file.

### Configuration Options

- **`--config, -c <path>`** - Path to your 1MCP configuration file.

## Examples

### Basic Usage

```bash
# Consolidate Claude Desktop
1mcp app consolidate claude-desktop

# Consolidate multiple apps at once
1mcp app consolidate claude-desktop cursor vscode

# Preview the changes for an app without applying them
1mcp app consolidate cursor --dry-run
```

### Advanced Usage

```bash
# Use a custom 1MCP server URL
1mcp app consolidate claude-desktop --url=http://localhost:3052/mcp

# Skip confirmation prompts for scripting
1mcp app consolidate vscode --yes

# Get manual setup instructions for an app
1mcp app consolidate cherry-studio --manual-only
```

## See Also

- **[App Consolidation Guide](/guide/integrations/app-consolidation)**
- **[app restore](/commands/app/restore)** - Restore an application to its original state.
- **[app status](/commands/app/status)** - Check the consolidation status of applications.
