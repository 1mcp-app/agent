---
title: Management Tools
description: MCP internal tools for managing MCP server state, configuration, health monitoring, and operational control
head:
  - ['meta', { name: 'keywords', content: 'MCP management,server control,monitoring,AI assistant' }]
  - ['meta', { property: 'og:title', content: 'Management Tools - 1MCP Internal Tools' }]
  - [
      'meta',
      { property: 'og:description', content: 'MCP internal tools for server management and operational control' },
    ]
---

# Management Tools

Management tools provide comprehensive operational control over MCP servers, including state management, configuration editing, health monitoring, and performance optimization. These tools focus on providing fine-grained control and real-time visibility for AI assistants.

## Tools Overview

### mcp_enable

Enable disabled MCP servers, supporting selective feature activation and dependency validation. Ensures servers meet all operational requirements before being enabled.

### mcp_disable

Gracefully disable MCP servers, supporting connection drainage and state preservation. Supports temporary disabling or complete service shutdown.

### mcp_list

List all configured MCP servers, supporting filtering by status, tags, and functionality. Provides detailed runtime information and configuration overview.

### mcp_status

Get detailed status information for specific servers, including health metrics, performance statistics, and diagnostic information. Supports historical status tracking and trend analysis.

### mcp_reload

Reload server configurations or restart servers, supporting hot reload and zero-downtime updates. Includes rollback mechanisms and configuration validation.

### mcp_edit

Edit MCP server configurations, providing real-time validation, schema checking, and syntax highlighting. Supports configuration templates and batch updates.

## Usage Patterns

### Server Lifecycle Management

AI assistants manage server states through simple tool calls:

- Use `mcp_enable` to activate disabled servers with validation options
- Use `mcp_disable` to gracefully shut down servers with connection drainage
- Use `mcp_status` to verify server state before and after operations
- Use `mcp_list` to discover servers and filter by status or tags

### Configuration Management

AI assistants manage configurations through:

- `mcp_edit` for making configuration changes with validation
- `mcp_reload` for applying configuration updates
- Built-in backup and rollback capabilities in `mcp_edit`
- Hot reload support for zero-downtime updates

### Health Monitoring

AI assistants monitor server health by:

- Using `mcp_status` with metrics and diagnostics options
- Monitoring multiple servers through `mcp_list` followed by status checks
- Analyzing performance trends and resource usage
- Identifying and responding to health issues

## AI Assistant Use Cases

### Server Health Monitoring

AI assistants can maintain server health by regularly checking status across all servers, identifying unhealthy or inactive servers, and reporting issues for attention.

### Configuration Management

AI assistants can automate configuration tasks by applying standard configurations across server groups, validating changes before application, and using backup features for safe modifications.

### Troubleshooting

AI assistants can diagnose server issues by collecting status and diagnostic information, analyzing common problems like high resource usage or error rates, and providing actionable recommendations.

## Tool Interactions

Management tools work effectively in sequences:

- **State Management**: `mcp_list` → `mcp_status` → `mcp_enable/disable`
- **Configuration Updates**: `mcp_status` → `mcp_edit` → `mcp_reload`
- **Health Monitoring**: `mcp_status` with metrics for ongoing monitoring
- **Targeted Operations**: `mcp_list` with filtering for specific server groups

## Best Practices for AI Assistants

1. **Verify prerequisites** before making changes
2. **Use status checks** to confirm operation success
3. **Handle errors gracefully** and provide clear feedback
4. **Monitor server health** before and after operations
5. **Create backups** using mcp_edit options before configuration changes
6. **Use batch operations** efficiently for multiple server management
7. **Implement retry logic** for transient failures
8. **Validate configurations** before applying changes

## See Also

- [Discovery Tools](./discovery) - Server discovery and evaluation
- [Installation Tools](./installation) - Server lifecycle management
- [MCP Commands Reference](../../commands/mcp/) - CLI server management commands
