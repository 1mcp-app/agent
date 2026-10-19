---
title: MCP Uninstall Command - Safe Server Removal
description: Safely uninstall MCP servers with automatic backup creation and dependency checking. Remove servers and clean up configurations.
head:
  - ['meta', { name: 'keywords', content: 'MCP uninstall,server removal,backup creation,safe deletion' }]
  - ['meta', { property: 'og:title', content: '1MCP Uninstall Command - Safe Server Removal' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Safely uninstall MCP servers with backup creation and dependency checking.',
      },
    ]
---

# mcp uninstall

Safely remove MCP servers from your configuration with automatic backup creation and dependency validation. The uninstall command ensures safe removal with rollback capabilities.

## Synopsis

Remove a server with confirmation and backup:

```bash
npx -y @1mcp/agent mcp uninstall <server-name>
```

Skip confirmation prompts:

```bash
npx -y @1mcp/agent mcp uninstall <server-name> --force
```

Remove without creating backup:

```bash
npx -y @1mcp/agent mcp uninstall <server-name> --no-backup
```

Remove only configuration (keep server data):

```bash
npx -y @1mcp/agent mcp uninstall <server-name> --no-remove-config
```

## Arguments

`<server-name>` (required)
: The name of the server to uninstall. Must be an existing server in your configuration.

## Global Options

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--force, -y`**
  - Skip confirmation prompts and proceed with uninstallation
  - **Default**: `false`

- **`--backup`**
  - Create backup before removal
  - **Default**: `true`

- **`--remove-config`**
  - Remove server configuration from mcp.json
  - **Default**: `true`

- **`--verbose, -v`**
  - Display detailed uninstallation information
  - **Default**: `false`

## Examples

### Basic Server Removal

Remove a server with confirmation and backup:

```bash
npx -y @1mcp/agent mcp uninstall filesystem

# Output:
# 🔄 Preparing to uninstall 'filesystem'...
# ℹ️  Server 'filesystem' is currently running
# ℹ️  Server has the following capabilities: file_read, file_write, list_directory
# ℹ️  No other servers depend on 'filesystem'
#
# ⚠️  This will:
#   • Stop the 'filesystem' server
#   • Remove server configuration from mcp.json
#   • Create backup at: ~/.config/1mcp/backups/mcp-20240115-103000.json
#
# Continue? (y/N): y
#
# ✓ Server 'filesystem' stopped successfully
# ✓ Configuration removed from mcp.json
# ✓ Backup created: ~/.config/1mcp/backups/mcp-20240115-103000.json
# ✅ Uninstall completed successfully
```

### Force Uninstall

Skip confirmation prompts:

```bash
npx -y @1mcp/agent mcp uninstall filesystem --force

# Output:
# 🔄 Uninstalling 'filesystem'...
# ✓ Server stopped
# ✓ Configuration removed
# ✓ Backup created
# ✅ Uninstall completed
```

### Uninstall Without Backup

Remove server without creating backup (not recommended):

```bash
npx -y @1mcp/agent mcp uninstall test-server --no-backup

# Output:
# ⚠️  Skipping backup creation
# 🔄 Uninstalling 'test-server'...
# ✓ Server removed
# ✅ Uninstall completed without backup
```

### Verbose Uninstall

See detailed uninstallation process:

```bash
npx -y @1mcp/agent mcp uninstall database --verbose

# Output:
# 🔍 Analyzing server 'database'...
#   • Configuration found in mcp.json
#   • Server is currently running (PID: 12345)
#   • Dependencies: 0 servers depend on this
#   • Backup location: ~/.config/1mcp/backups/mcp-20240115-103500.json
#
# 🛡️  Safety checks passed
# 🔄 Proceeding with uninstallation...
#   • Gracefully stopping server process
#   • Removing from active server list
#   • Updating mcp.json configuration
#   • Creating configuration backup
#
# ✅ Uninstall completed successfully
```

## Safety Features

The uninstall command includes built-in safety measures:

- **Dependency Checking**: Warns if other servers depend on the one being removed
- **Automatic Backups**: Creates timestamped backups before removal (`~/.config/1mcp/backups/`)
- **Graceful Shutdown**: Properly stops servers before removal with SIGTERM/SIGKILL handling

## Error Handling

Common error scenarios:

```bash
# Server not found
npx -y @1mcp/agent mcp uninstall nonexistent-server
# Error: Server 'nonexistent-server' not found in configuration

# Permission issues
npx -y @1mcp/agent mcp uninstall system-server
# Error: Permission denied when stopping server process
```

## Backup Restoration

Restore from backup if needed:

```bash
# List available backups
ls ~/.config/1mcp/backups/

# Restore from backup
cp ~/.config/1mcp/backups/mcp-20240115-103000.json ~/.config/1mcp/mcp.json
```

## See Also

- **[mcp install](install.md)** - Install servers from registry
- **[mcp disable](enable-disable.md)** - Temporarily disable servers
- **[mcp list](list.md)** - List installed servers
- **[Server Management Guide](../../guide/essentials/server-management.md)** - Complete server management overview
- **[Configuration Reference](../../reference/mcp-servers.md)** - Configuration file structure
