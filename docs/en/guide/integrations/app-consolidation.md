---
title: App Consolidation Guide - Unify Multiple Desktop App Configs
description: Consolidate MCP server configurations from Claude Desktop, Cursor, and other desktop apps into a single 1MCP instance. Step-by-step consolidation guide.
head:
  - ['meta', { name: 'keywords', content: 'app consolidation,desktop apps,config management,MCP configuration' }]
  - ['meta', { property: 'og:title', content: '1MCP App Consolidation Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Unify MCP server configurations from multiple desktop apps into one 1MCP instance.',
      },
    ]
---

# App Consolidation Guide

This guide provides a comprehensive overview of the app consolidation feature in 1MCP Agent. It helps you unify MCP server configurations from multiple desktop applications into a single, manageable 1MCP instance.

## The Core Concept

Many desktop development tools use their own MCP server configurations. Managing these separately is inefficient and prevents them from sharing server resources.

**Before Consolidation:**

```
Claude Desktop → [filesystem, postgres] servers
Cursor → [github, database] servers
VS Code → [typescript, eslint] servers
```

**The Goal:**
App consolidation streamlines this by routing all applications through a single 1MCP proxy. This allows all your tools to access all your servers.

**After Consolidation:**

```
Claude Desktop ↘
Cursor --------→ 1MCP → [filesystem, postgres, github, database, typescript, eslint]
VS Code -------↗
```

## The Consolidation Workflow

The process is designed to be safe and reversible.

1.  **Discover**: Find which supported applications are installed and have MCP configurations.
    ```bash
    npx -y @1mcp/agent app discover
    ```
2.  **Consolidate**: Preview and then execute the consolidation. This command extracts servers from an app's config, adds them to 1MCP, and points the app's config to your 1MCP server.

    ```bash
    # Preview the changes first
    npx -y @1mcp/agent app consolidate claude-desktop --dry-run

    # Run the consolidation
    npx -y @1mcp/agent app consolidate claude-desktop
    ```

3.  **Check Status**: Verify that the application is now marked as "Consolidated".
    ```bash
    npx -y @1mcp/agent app status claude-desktop
    ```

## Supported Applications

This is the definitive list of applications supported by the `app` commands.

### Automatically Configurable

These applications support fully automatic consolidation and restoration. 1MCP can read their configuration files, modify them, and safely back them up.

- **claude-desktop**: Claude Desktop application
- **cursor**: Cursor code editor
- **vscode**: Visual Studio Code
- **roo-code**: Roo Code / Cline extension

### Manual Setup Required

These applications are supported, but their configuration is not directly accessible to 1MCP. The `consolidate` command will provide you with step-by-step instructions to configure them manually.

- **cherry-studio**: Cherry Studio
- **continue**: Continue VS Code extension
- **copilot**: GitHub Copilot

## Backup and Restore System

Safety is a core principle of the consolidation feature. 1MCP automatically creates a backup of your original configuration files before making any changes.

### How Backups Work

- **Automatic Creation**: Backups are created automatically during the `consolidate` process.
- **Location**: The backup is stored in the same directory as the original configuration file.
- **Naming**: Backups are named using the format `<original-filename>.backup.<timestamp>.meta`.
- **Content**: The backup file is a JSON object containing the original configuration content plus metadata about the consolidation operation.

### Managing Backups

You can manage all backups using the `npx -y @1mcp/agent app backups` command.

- **List all backups**: `npx -y @1mcp/agent app backups`
- **List backups for a specific app**: `npx -y @1mcp/agent app backups claude-desktop`
- **Verify backup integrity**: `npx -y @1mcp/agent app backups --verify`
- **Clean up old backups**: `npx -y @1mcp/agent app backups --cleanup=30` (deletes backups older than 30 days)

### Restoring from a Backup

If you need to undo a consolidation, you can easily restore the original configuration.

- **Restore the latest backup for an app**:
  ```bash
  npx -y @1mcp/agent app restore claude-desktop
  ```
- **Restore all consolidated applications**:
  ```bash
  npx -y @1mcp/agent app restore --all
  ```
- **Restore from a specific backup file**:
  ```bash
  npx -y @1mcp/agent app restore --backup /path/to/your/config.backup.1640995200000.meta
  ```

## Best Practices

### Before Consolidation

1.  Ensure your 1MCP server is running and accessible.
2.  Use `npx -y @1mcp/agent app discover` to see what applications can be consolidated.
3.  Always use the `--dry-run` flag first to preview changes before applying them.
4.  Close the target desktop applications before running the `consolidate` command.

### During Consolidation

1.  Start by consolidating one application at a time.
2.  After consolidating an app, launch it and test its functionality.
3.  Set `ONE_MCP_LOG_LEVEL=debug` if you encounter issues to get more detailed logs.

### After Consolidation

1.  Verify that all expected MCP servers are available in the consolidated applications.
2.  Regularly use `npx -y @1mcp/agent app backups --cleanup <days>` to remove old, unneeded backups.

## Troubleshooting

### Config file not found

- **Cause**: The application might not be installed, or it has never been run, so its config file hasn't been created yet.
- **Solution**: Ensure the application is installed and run it at least once. Use `npx -y @1mcp/agent app discover --show-paths` to see where 1MCP is looking for the config file.

### Permission denied

- **Cause**: You may not have the necessary write permissions for the application's configuration file.
- **Solution**: Ensure you are running the command with a user account that has the correct permissions. Close the application before running the command, as it may have a lock on the file.

### 1MCP server not running

- **Cause**: The `consolidate` command needs to connect to a running 1MCP server to validate the URL.
- **Solution**: Start your 1MCP server using `npx -y @1mcp/agent serve`. You can verify its status with `curl http://localhost:3051/health` (adjust port if needed).
