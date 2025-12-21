---
title: MCP Search Command - Registry Server Discovery
description: Search the MCP registry for available servers. This command is an alias for 'registry search' and provides quick access to server discovery.
head:
  - ['meta', { name: 'keywords', content: 'MCP search,registry server discovery,server browsing,filtering' }]
  - ['meta', { property: 'og:title', content: '1MCP Search Command - Registry Server Discovery' }]
  - [
      'meta',
      { property: 'og:description', content: 'Search the MCP registry for available servers with filtering options.' },
    ]
---

# mcp search

Search the MCP registry for available servers. This command provides quick access to server discovery and is an alias for the `registry search` command.

## Synopsis

Search for servers by query:

```bash
npx -y @1mcp/agent mcp search <query>
```

Browse all available servers:

```bash
npx -y @1mcp/agent mcp search
```

## Arguments

`<query>` (optional)
: Search query string to match against server names, descriptions, and tags.

## Examples

### Basic Search

Search for database-related servers:

```bash
npx -y @1mcp/agent mcp search database
```

### Browse All Servers

List all available servers:

```bash
npx -y @1mcp/agent mcp search
```

## See Also

- **[registry search](../registry/search.md)** - Full registry search command with advanced options
- **[registry commands](../registry/)** - Complete registry command documentation
- **[mcp install](install.md)** - Install servers found through search
