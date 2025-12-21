---
title: MCP Internal Tools Reference
description: Complete reference documentation for 1MCP internal tools - MCP protocol tools for server discovery, installation, and management
head:
  - [
      'meta',
      { name: 'keywords', content: 'MCP internal tools,protocol tools,AI assistant,server management,automation' },
    ]
  - ['meta', { property: 'og:title', content: 'MCP Internal Tools Reference - 1MCP' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete reference for MCP internal tools used by AI assistants for server management',
      },
    ]
---

# MCP Internal Tools

MCP internal tools are Model Context Protocol tools that enable AI assistants to discover, install, manage, and interact with MCP servers programmatically. These tools are exposed through the MCP protocol and provide comprehensive automation capabilities for server lifecycle management.

Unlike CLI commands which are used by humans, internal tools are designed specifically for AI assistant integration and automated workflows.

## Overview

The internal tools are organized into three functional domains:

- **[Discovery Tools](./internal-tools/discovery)** - Search registries and discover MCP servers
- **[Installation Tools](./internal-tools/installation)** - Install, update, and remove MCP servers
- **[Management Tools](./internal-tools/management)** - Control server operational state and configuration

## Tool Categories

### Discovery Tools

Enable AI assistants to search for and discover MCP servers from various registries and sources.

- **`mcp_search`** - Search MCP registry for servers
- **`mcp_registry_status`** - Check registry availability and health
- **`mcp_registry_info`** - Get detailed registry information
- **`mcp_registry_list`** - List available registries
- **`mcp_info`** - Get detailed server information

### Installation Tools

Provide complete lifecycle management for MCP server installation and removal.

- **`mcp_install`** - Install MCP server from registry or custom source
- **`mcp_uninstall`** - Remove MCP server with backup and rollback options
- **`mcp_update`** - Update MCP server to latest or specified version

### Management Tools

Offer operational control over MCP servers including state management and configuration.

- **`mcp_enable`** - Enable a disabled MCP server
- **`mcp_disable`** - Disable an MCP server without removal
- **`mcp_list`** - List MCP servers with filtering and status information
- **`mcp_status`** - Get detailed server status and health information
- **`mcp_reload`** - Reload server configuration or restart server
- **`mcp_edit`** - Edit MCP server configuration

## Use Cases

### AI Assistant Automation

AI assistants can use these tools to automatically:

- **Discover relevant servers** for specific tasks or domains
- **Install required servers** based on user needs or project requirements
- **Manage server lifecycle** including updates, health monitoring, and troubleshooting
- **Orchestrate complex workflows** involving multiple MCP servers

### Programmatic Server Management

Developers can integrate these tools into:

- **CI/CD pipelines** for automated MCP server deployment
- **Infrastructure as code** solutions for server configuration
- **Monitoring systems** for server health and performance tracking
- **Automated testing** frameworks for MCP server validation

### Dynamic Configuration

Tools enable dynamic server management scenarios:

- **On-demand server installation** based on user requirements
- **Graceful server updates** with rollback capabilities
- **Health-based server failover** and recovery
- **Configuration synchronization** across environments

## Key Features

### Comprehensive API Coverage

All internal tools provide complete input/output schemas with:

- **Typed parameters** with validation and constraints
- **Structured output** with consistent data formats
- **Error handling** with detailed error information
- **Progress feedback** for long-running operations

### Safe Operations

Internal tools prioritize safety and reliability:

- **Backup and restore** capabilities for destructive operations
- **Dependency validation** to prevent breaking changes
- **Rollback support** for failed operations
- **Health checks** before and after operations

### Integration-Friendly

Designed for seamless AI assistant integration:

- **Semantic naming** following MCP conventions
- **Descriptive error messages** for troubleshooting
- **Progress indicators** for user feedback
- **Cross-references** between related operations

## API Reference

For detailed API documentation including schemas, parameters, and examples:

- **[Discovery Tools](./internal-tools/discovery)** - Discovery domain tools and workflows
- **[Installation Tools](./internal-tools/installation)** - Installation domain tools and safety features
- **[Management Tools](./internal-tools/management)** - Management domain tools and operational control

## Getting Started

AI assistants typically access these tools through the MCP protocol when connected to a 1MCP instance. The tools are automatically available based on the server's capabilities and configuration.

For CLI users, many of these capabilities are also available through the [1MCP commands](../commands/), providing human-friendly interfaces for the same operations.

## See Also

- [Server Management Guide](../guide/essentials/server-management) - Manual server management
- [MCP Commands Reference](../commands/mcp/) - CLI commands for server management
