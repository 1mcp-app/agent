---
title: Discovery Tools
description: MCP internal tools for discovering and searching MCP servers, registries, and server information
head:
  - ['meta', { name: 'keywords', content: 'MCP discovery,server search,registry,AI assistant' }]
  - ['meta', { property: 'og:title', content: 'Discovery Tools - 1MCP Internal Tools' }]
  - ['meta', { property: 'og:description', content: 'MCP internal tools for server discovery and registry management' }]
---

# Discovery Tools

Discovery tools enable AI assistants to find, evaluate, and gather information about MCP servers from various sources. These tools provide comprehensive search capabilities, registry management, and detailed server information retrieval.

## Tools Overview

### mcp_search

Search MCP registries for servers matching specific criteria. Supports advanced filtering, categorization, and fuzzy matching to find relevant servers for any use case.

### mcp_registry_status

Check the availability and health of MCP registries. Provides performance metrics, uptime information, and connectivity status to ensure reliable registry access.

### mcp_registry_info

Get detailed information about specific MCP registries including supported features, authentication requirements, and server statistics.

### mcp_registry_list

List all available MCP registries with their capabilities and access requirements. Helps identify the best registry sources for different types of servers.

### mcp_info

Retrieve comprehensive information about specific MCP servers including capabilities, requirements, version history, and compatibility details.

## Usage Patterns

### Server Discovery Workflow

AI assistants typically follow this discovery pattern:

1. **Registry Check**: Use `mcp_registry_status` to verify registry availability
2. **Server Search**: Use `mcp_search` with relevant filters and categories
3. **Server Details**: Use `mcp_info` to get detailed information about promising servers
4. **Registry Information**: Use `mcp_registry_info` and `mcp_registry_list` to understand available sources

### Search Strategies

AI assistants can effectively search for servers by:

- Using specific queries with relevant keywords and categories
- Applying filters for tags, capabilities, and compatibility
- Leveraging fuzzy matching for approximate search terms
- Sorting results by relevance, popularity, or recency

### Registry Management

AI assistants manage registry operations by:

- Checking multiple registry status for reliability
- Comparing server availability across different registries
- Monitoring registry performance and response times
- Identifying the most appropriate registry for specific needs

## AI Assistant Use Cases

### Automated Server Discovery

AI assistants can automatically find suitable servers by analyzing user requirements, searching with appropriate parameters, evaluating server capabilities against needs, and recommending optimal server choices.

### Registry Health Monitoring

AI assistants can monitor registry availability, track performance metrics over time, identify connectivity issues, and report registry problems for attention.

### Server Evaluation

AI assistants can evaluate servers by comparing capabilities, checking version compatibility, analyzing dependency requirements, and assessing community metrics like popularity and ratings.

## Tool Interactions

Discovery tools work effectively in combination:

- **Discovery Process**: `mcp_registry_status` → `mcp_search` → `mcp_info`
- **Registry Analysis**: `mcp_registry_list` → `mcp_registry_info` → `mcp_registry_status`
- **Server Research**: `mcp_search` (with filters) → `mcp_info` (for details)
- **Health Monitoring**: Regular `mcp_registry_status` checks for reliability

## Best Practices for AI Assistants

1. **Check registry status** before performing searches
2. **Use specific search terms** with relevant filters
3. **Compare multiple sources** using different registries
4. **Verify server compatibility** before recommendations
5. **Monitor search performance** and adjust query complexity
6. **Cache server information** when appropriate for efficiency
7. **Use fallback registries** when primary sources are unavailable
8. **Validate search results** for relevance and accuracy

## See Also

- [Installation Tools](./installation) - Server lifecycle management
- [Management Tools](./management) - Server operational control
- [MCP Commands Reference](../../commands/mcp/) - CLI discovery commands
