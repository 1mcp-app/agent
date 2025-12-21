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

--config-path `<path>`
: Path to a specific configuration file.

--config-dir `<path>`
: Path to the configuration directory containing `mcp.json`.

## Command-Specific Options

--force, -y
: Skip confirmation prompts and proceed with uninstallation.

--no-backup
: Skip automatic backup creation before removal. Not recommended for production configurations.

--backup
: Create backup before removal (default: true).

--remove-config
: Remove server configuration from mcp.json (default: true).

--no-remove-config
: Keep server configuration but mark as disabled.

--verbose
: Display detailed uninstallation information.

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

### Disable Instead of Remove

Keep configuration but disable the server:

```bash
npx -y @1mcp/agent mcp uninstall filesystem --no-remove-config

# Output:
# 🔄 Disabling 'filesystem' instead of removal...
# ✓ Server stopped
# ✓ Configuration retained but disabled
# ✓ Backup created
# ✅ Server disabled successfully
# 💡 Use 'mcp enable filesystem' to re-enable
```

## Safety Features

### Dependency Checking

The uninstall command checks for dependencies before removal:

```bash
npx -y @1mcp/agent mcp uninstall shared-storage

# Output:
# ❌ Cannot uninstall 'shared-storage'
#
# The following servers depend on 'shared-storage':
#   • file-processor (uses shared-storage for temporary files)
#   • backup-service (uses shared-storage for backup storage)
#
# Uninstall dependent servers first or use --force to proceed.
```

### Automatic Backups

By default, the uninstall command creates timestamped backups:

```bash
# Backup location examples:
~/.config/1mcp/backups/mcp-20240115-103000.json
~/.config/1mcp/backups/mcp-20240115-103500.json
```

Backup files include:

- Complete mcp.json configuration
- Server metadata and installation info
- Timestamp for easy identification

### Graceful Shutdown

Servers are gracefully stopped before removal:

```bash
# Process for graceful shutdown:
1. Send SIGTERM signal to server process
2. Wait up to 10 seconds for graceful shutdown
3. Send SIGKILL if still running
4. Verify process termination
5. Remove from server manager
```

## Error Handling

Common error scenarios and solutions:

```bash
# Server not found
npx -y @1mcp/agent mcp uninstall nonexistent-server
# Error: Server 'nonexistent-server' not found in configuration
# Use 'mcp list' to see available servers

# Server dependencies
npx -y @1mcp/agent mcp uninstall shared-server --force
# Warning: Removing server with dependencies
# Dependencies will be affected: file-processor, backup-service

# Permission issues
npx -y @1mcp/agent mcp uninstall system-server
# Error: Permission denied when stopping server process
# Try with elevated privileges or check server status
```

## Backup Restoration

Restore from backup if needed:

```bash
# List available backups
ls ~/.config/1mcp/backups/

# Restore from backup
cp ~/.config/1mcp/backups/mcp-20240115-103000.json ~/.config/1mcp/mcp.json

# Reload configuration
npx -y @1mcp/agent mcp reload
```

## Cleanup Options

The uninstall command provides several cleanup options:

### Remove Configuration Only

```bash
npx -y @1mcp/agent mcp uninstall server-name --remove-config
# Removes from mcp.json but keeps server running if active
```

### Keep Configuration

```bash
npx -y @1mcp/agent mcp uninstall server-name --no-remove-config
# Disables server but keeps configuration for future use
```

### Custom Backup Location

```bash
ONE_MCP_CONFIG_DIR=/custom/path npx -y @1mcp/agent mcp uninstall server-name
# Creates backup in custom config directory
```

## Integration with Registry

For registry-installed servers, uninstall also:

```bash
# Removes registry metadata
npx -y @1mcp/agent mcp uninstall filesystem

# Registry metadata removed:
#   • Installation timestamp
#   • Source registry information
#   • Version tracking data
#   • Update notifications
```

## See Also

- **[mcp install](install.md)** - Install servers from registry
- **[mcp disable](enable-disable.md)** - Temporarily disable servers
- **[mcp list](list.md)** - List installed servers
- **[Server Management Guide](../../guide/essentials/server-management.md)** - Complete server management overview
- **[Configuration Reference](../../reference/mcp-servers.md)** - Configuration file structure
