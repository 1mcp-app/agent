---
title: Registry Commands - MCP Server Discovery and Management
description: Complete guide to 1MCP registry commands for server discovery, installation, version management, and dependency resolution.
head:
  - ['meta', { name: 'keywords', content: 'MCP registry,server discovery,version management,dependency resolution' }]
  - ['meta', { property: 'og:title', content: '1MCP Registry Commands - Server Discovery and Management' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Discover, install, and manage MCP servers through the 1MCP registry with version control and dependency management.',
      },
    ]
---

# Registry Commands

The 1MCP registry provides centralized server discovery, version management, and dependency resolution for MCP servers. Registry commands enable you to search for servers, view detailed information, check versions, and manage server installations.

> **Quick Start**: Use `npx @1mcp/agent mcp install <server-name>` for streamlined installation.

## Overview

The 1MCP registry is a centralized repository that:

- **Discovers** available MCP servers across categories
- **Manages** versioning and compatibility information
- **Resolves** dependencies automatically
- **Validates** server integrity and security
- **Provides** detailed server metadata and documentation

## Available Commands

### Server Discovery

- **[registry search](search.md)** - Search for servers by name, category, or tags

## Registry Workflow

### 1. Discovery

Find servers that match your needs:

```bash
# Search by category
npx -y @1mcp/agent registry search --category=filesystem

# Search by functionality
npx -y @1mcp/agent registry search "database"

# Browse all servers
npx -y @1mcp/agent registry search
```

### 2. Information Gathering

Get detailed information about servers:

```bash
# View server details
npx -y @1mcp/agent registry show filesystem

# Check available versions
npx -y @1mcp/agent registry versions filesystem

# See dependencies and requirements
npx -y @1mcp/agent registry show postgresql --deps
```

### 3. Installation

Install servers with automatic dependency resolution:

```bash
# Install latest version
npx -y @1mcp/agent mcp install filesystem

# Install specific version
npx -y @1mcp/agent mcp install filesystem@1.2.0

# Install with interactive wizard
npx -y @1mcp/agent mcp install --interactive
```

### 4. Management

Keep servers updated and managed:

```bash
# Check for updates
npx -y @1mcp/agent registry updates

# Update specific server
npx -y @1mcp/agent mcp update filesystem

# Remove server
npx -y @1mcp/agent mcp uninstall filesystem
```

## Server Categories

The registry organizes servers into functional categories:

### System & File Management

- **Filesystem** - File system access and operations
- **Database** - Database connectivity and operations
- **Storage** - Cloud storage and object management
- **Backup** - Data backup and recovery tools

### Development Tools

- **Git** - Version control and repository operations
- **Build** - Build systems and compilation tools
- **Testing** - Testing frameworks and utilities
- **Debugging** - Debugging and profiling tools

### Web & Network

- **HTTP** - HTTP client and API tools
- **Search** - Web search and information retrieval
- **Scraping** - Web scraping and data extraction
- **API** - API integration and management

### Data Processing

- **Analytics** - Data analysis and reporting
- **Machine Learning** - ML model serving and training
- **ETL** - Data transformation and pipelines
- **Visualization** - Data visualization tools

### Communication

- **Email** - Email sending and management
- **Chat** - Messaging and communication platforms
- **Calendar** - Calendar and scheduling tools
- **Notification** - Alert and notification systems

## Server Metadata

Each server in the registry includes comprehensive metadata:

```json
{
  "name": "filesystem",
  "displayName": "File System Server",
  "description": "File system access and management capabilities",
  "version": "1.2.0",
  "category": "System",
  "tags": ["filesystem", "files", "local", "storage"],
  "maintainer": "Model Context Protocol Team",
  "license": "MIT",
  "homepage": "https://github.com/modelcontextprotocol/servers",
  "repository": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  "documentation": "https://docs.modelcontextprotocol.io/servers/filesystem",
  "dependencies": [],
  "engines": {
    "node": ">=14.0.0"
  },
  "platforms": ["linux", "darwin", "win32"],
  "transport": ["stdio"],
  "capabilities": {
    "tools": ["read_file", "write_file", "list_directory", "create_directory"],
    "resources": ["file://*"]
  },
  "security": {
    "trusted": true,
    "sandboxed": false,
    "permissions": ["filesystem"]
  },
  "installation": {
    "npm": "@modelcontextprotocol/server-filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem"]
  },
  "changelog": "https://github.com/modelcontextprotocol/servers/blob/main/CHANGELOG.md"
}
```

## Version Management

The registry follows semantic versioning (SemVer):

- **Major versions** - Breaking changes
- **Minor versions** - New features (backward compatible)
- **Patch versions** - Bug fixes (backward compatible)

### Version Selection

```bash
# Install latest stable
npx -y @1mcp/agent mcp install filesystem

# Install specific major version
npx -y @1mcp/agent mcp install filesystem@1

# Install specific minor version
npx -y @1mcp/agent mcp install filesystem@1.2

# Install exact version
npx -y @1mcp/agent mcp install filesystem@1.2.0

# Install pre-release version
npx -y @1mcp/agent mcp install filesystem@2.0.0-beta.1
```

## Security and Trust

The registry includes security validation:

- **Trusted Sources** - Verified maintainers and repositories
- **Vulnerability Scanning** - Automated security checks
- **Dependency Auditing** - Package dependency security analysis
- **Code Review** - Community review process

## Private Registries

For enterprise and private server management:

```bash
# Configure private registry
npx -y @1mcp/agent registry config --add private.registry.com

# Authenticate with private registry
npx -y @1mcp/agent registry login private.registry.com

# Search private registry
npx -y @1mcp/agent registry search --registry=private.registry.com
```

## Integration with MCP Commands

Registry commands integrate seamlessly with MCP commands:

```bash
# These are equivalent:
npx -y @1mcp/agent registry search filesystem
npx -y @1mcp/agent mcp install --search filesystem

# Install from registry search results
npx -y @1mcp/agent registry search database | head -5 | xargs -I {} npx -y @1mcp/agent mcp install {}

# Check updates for all installed servers
npx -y @1mcp/agent registry updates --installed
```

## Cache Management

Registry operations use local caching for performance:

```bash
# Clear registry cache
npx -y @1mcp/agent registry cache --clear

# Force refresh server information
npx -y @1mcp/agent registry show filesystem --refresh

# Set cache expiration
npx -y @1mcp/agent registry config --cache-expire=1h
```

## Best Practices

### Server Selection

1. **Check Compatibility** - Ensure server matches your environment
2. **Review Dependencies** - Understand required dependencies
3. **Read Documentation** - Review server capabilities and limitations
4. **Check Maintenance** - Prefer actively maintained servers
5. **Test in Development** - Validate servers in non-production environments

### Version Management

1. **Use Specific Versions** - Pin versions for production stability
2. **Test Updates** - Validate new versions before upgrading
3. **Monitor Changelogs** - Track changes and deprecations
4. **Backup Configuration** - Keep backups of working configurations
5. **Rollback Plan** - Prepare downgrade strategies

### Security

1. **Verify Sources** - Only use servers from trusted maintainers
2. **Review Permissions** - Understand server access requirements
3. **Regular Updates** - Keep servers updated for security patches
4. **Isolate Environments** - Use separate configs for different environments
5. **Audit Dependencies** - Monitor dependency security updates

## See Also

- **[mcp install](../mcp/install.md)** - Install servers from registry
- **[mcp uninstall](../mcp/uninstall.md)** - Remove installed servers
- **[Server Management Guide](../../guide/essentials/server-management.md)** - Complete server management
- **[Configuration Reference](../../reference/mcp-servers.md)** - Configuration details
- **[Getting Started](../../guide/getting-started.md)** - Initial setup instructions
