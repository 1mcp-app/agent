---
title: Installation Tools
description: MCP internal tools for installing, updating, and managing MCP server lifecycle
head:
  - ['meta', { name: 'keywords', content: 'MCP installation,server management,lifecycle,AI assistant' }]
  - ['meta', { property: 'og:title', content: 'Installation Tools - 1MCP Internal Tools' }]
  - [
      'meta',
      { property: 'og:description', content: 'MCP internal tools for server installation and lifecycle management' },
    ]
---

# Installation Tools

Installation tools enable AI assistants to manage the complete lifecycle of MCP servers, from initial installation through updates and removal. These tools provide flexible installation options, dependency management, and safe operation handling.

## Tools Overview

### mcp_install

Install MCP servers from various sources including registries, Git repositories, or custom URLs. Supports version specification, dependency resolution, and automatic configuration.

### mcp_uninstall

Remove MCP servers safely with dependency checking, backup options, and cleanup of related resources. Ensures clean removal without affecting other servers.

### mcp_update

Update MCP servers to newer versions with compatibility checking, rollback capabilities, and migration support. Handles version conflicts and dependency updates automatically.

## Usage Patterns

### Server Installation Workflow

AI assistants typically follow this installation pattern:

1. **Discovery**: Use discovery tools to find suitable servers
2. **Installation**: Use `mcp_install` with appropriate source and version
3. **Verification**: Use management tools to confirm successful installation
4. **Configuration**: Apply necessary settings and enable the server

### Installation Sources

AI assistants can install servers from multiple sources:

- **Registry Installation**: Install from official or third-party registries
- **Git Repository**: Direct installation from Git repositories
- **Custom Sources**: Installation from specific URLs or local paths
- **Version Specification**: Install specific versions or latest stable releases

### Update Management

AI assistants handle updates through:

- **Compatibility Checking**: Verify version compatibility before updates
- **Dependency Resolution**: Handle dependency updates automatically
- **Rollback Support**: Revert to previous versions if issues occur
- **Migration Assistance**: Help with configuration migrations

## AI Assistant Use Cases

### Automated Environment Setup

AI assistants can automatically set up complete environments by identifying required servers for specific tasks, installing servers with correct versions, resolving dependencies automatically, and configuring servers for immediate use.

### Maintenance and Updates

AI assistants can maintain server environments by monitoring for available updates, scheduling updates during maintenance windows, testing compatibility before applying updates, and handling rollback if issues arise.

### Server Management

AI assistants can manage server populations by tracking installed servers and versions, identifying unused or deprecated servers, coordinating updates across server groups, and ensuring consistent environments across deployments.

## Tool Interactions

Installation tools work effectively with other tool categories:

- **Discovery to Installation**: Discovery tools → `mcp_install` → Management tools verification
- **Update Workflows**: Management tools status check → `mcp_update` → `mcp_reload`
- **Removal Process**: Management tools dependency check → `mcp_uninstall` → cleanup
- **Complete Lifecycle**: Discovery → Installation → Management → Updates → Removal

## Best Practices for AI Assistants

1. **Verify prerequisites** before installation attempts
2. **Use compatible versions** based on system requirements
3. **Check dependencies** to avoid conflicts
4. **Create backups** before major updates
5. **Test installations** in safe environments first
6. **Monitor installation progress** and handle errors appropriately
7. **Document custom configurations** for reproducibility
8. **Plan rollback strategies** before applying updates

## Safety Considerations

AI assistants should prioritize safety by:

- Checking system compatibility before installation
- Verifying source authenticity and security
- Using appropriate version constraints
- Testing in non-production environments when possible
- Maintaining backup copies of critical configurations
- Following dependency best practices to avoid conflicts

## See Also

- [Discovery Tools](./discovery) - Server discovery and search
- [Management Tools](./management) - Server operational control
- [MCP Commands Reference](../../commands/mcp/) - CLI installation commands
