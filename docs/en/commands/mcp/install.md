---
title: MCP Install Command - Registry-Based Server Installation
description: Install MCP servers from the 1MCP registry with interactive installation. Discover and install servers with version management and dependency resolution.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'MCP install,registry server installation,interactive installation,server discovery',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Install Command - Registry Server Installation' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Install MCP servers from the registry with interactive installation and version management.',
      },
    ]
---

# mcp install

Install MCP servers from the 1MCP registry with automatic dependency resolution and version management. The install command provides both interactive installation and direct server installation by name.

> **Note**: This is the recommended way to add MCP servers to your configuration. For manual configuration, see the [add command](add.md).

## Synopsis

Launch interactive installation wizard:

```bash
npx -y @1mcp/agent mcp install
```

Install a server by name from the registry:

```bash
npx -y @1mcp/agent mcp install <server-name>
```

Install with specific version:

```bash
npx -y @1mcp/agent mcp install <server-name>@<version>
```

Preview installation without making changes:

```bash
npx -y @1mcp/agent mcp install <server-name> --dry-run
```

Force reinstallation:

```bash
npx -y @1mcp/agent mcp install <server-name> --force
```

## Arguments

- **`<server-name>`** (optional)
  - Server name or name@version to install. Can include full registry ID (e.g., `io.github.user/filesystem`).
  - **Required**: No

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--interactive, -i`**
  - Launch interactive installation wizard. This is the default when no server name is provided.

- **`--force`**
  - Force installation even if the server already exists. Overwrites existing configuration.

- **`--dry-run`**
  - Show what would be installed without making any changes to your configuration.

- **`--verbose, -v`**
  - Display detailed installation information.

## Examples

### Basic Server Installation

Install the latest version of the filesystem server:

```bash
npx -y @1mcp/agent mcp install filesystem
```

Install a specific version:

```bash
npx -y @1mcp/agent mcp install filesystem@1.2.0
```

### Interactive Installation

Launch the interactive installation wizard to browse and install servers:

```bash
npx -y @1mcp/agent mcp install
```

Or explicitly request interactive mode:

```bash
npx -y @1mcp/agent mcp install --interactive
```

The interactive mode will guide you through:

1. **Server Discovery** - Browse available servers by category
2. **Version Selection** - Choose compatible versions
3. **Configuration** - Set server-specific options
4. **Installation** - Confirm and install with dependencies

### Installation Preview

Preview what would be installed without making changes:

```bash
npx -y @1mcp/agent mcp install filesystem --dry-run

# Output:
# 📦 Installation Preview: filesystem@1.2.0
#
# Server: filesystem - File system access and management
# Version: 1.2.0
# Category: System
# Tags: filesystem, files, local
#
# Dependencies: None
# Configuration: Will prompt for root directory
#
# Use --verbose for detailed information
```

### Force Reinstallation

Replace an existing server configuration:

```bash
npx -y @1mcp/agent mcp install filesystem --force
```

### Verbose Installation

See detailed installation process including dependency resolution:

```bash
npx -y @1mcp/agent mcp install airtable --verbose

# Output:
# 🔍 Resolving dependencies for airtable@2.1.0...
# ✓ Dependency check complete
# 📥 Downloading server metadata...
# ✓ Validating server configuration
# ⚙️  Generating configuration...
# ✓ Server installed successfully as 'airtable'
```

## Interactive Wizard Workflow

When using `--interactive` or running without arguments, the install command launches an interactive wizard:

1. **Search or Browse**
   - Search by server name or category
   - Browse by category (System, Database, Web, Development, etc.)
   - Filter by tags and compatibility

2. **Server Selection**
   - View server descriptions and capabilities
   - Check version compatibility
   - Review dependencies and requirements

3. **Version Selection**
   - Choose from available versions
   - See version notes and compatibility
   - Get recommendations for stable vs latest versions

4. **Configuration**
   - Set server-specific parameters
   - Choose tags for organization
   - Configure transport options if applicable

5. **Confirmation**
   - Review complete configuration
   - See what will be installed
   - Confirm installation

## Registry Integration

The install command integrates with the 1MCP registry to provide:

- **Server Discovery**: Search and browse available MCP servers
- **Version Management**: Install specific versions with compatibility checking
- **Dependency Resolution**: Automatically install required dependencies
- **Security Validation**: Verify server integrity and authenticity
- **Update Notifications**: Get notified about available updates

## Configuration Output

Installed servers are added to your `mcp.json` configuration with registry metadata:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
      "tags": ["filesystem", "files", "local"],
      "_registry": {
        "name": "filesystem",
        "version": "1.2.0",
        "installedAt": "2024-01-15T10:30:00Z",
        "source": "1mcp-registry"
      }
    }
  }
}
```

## Error Handling

The install command provides helpful error messages for common scenarios:

```bash
# Server not found
npx -y @1mcp/agent mcp install nonexistent-server
# Error: Server 'nonexistent-server' not found in registry
# Suggestions: filesystem, git, database, search

# Version not available
npx -y @1mcp/agent mcp install filesystem@99.99.99
# Error: Version 99.99.99 not available for 'filesystem'
# Available versions: 1.2.0, 1.1.0, 1.0.0

# Already installed
npx -y @1mcp/agent mcp install filesystem
# Error: Server 'filesystem' already installed
# Use --force to reinstall or mcp update to upgrade
```

## See Also

- **[Registry Search](../registry/search.md)** - Search the registry for available servers
- **[mcp uninstall](uninstall.md)** - Remove installed servers
- **[mcp update](update.md)** - Update installed servers
- **[Server Management Guide](../../guide/essentials/server-management.md)** - Complete server management overview
- **[Registry Commands](../registry/)** - Full registry command documentation
