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

Search the MCP registry for available servers. This command is a **convenience alias** for the `registry search` command with limited options. For advanced filtering and options, use [registry search](/commands/registry/search) directly.

## Synopsis

Search for servers by query:

```bash
1mcp mcp search <query>
```

Browse all available servers:

```bash
1mcp mcp search
```

## Arguments

`<query>` (optional)
: Search query string to match against server names, descriptions, and tags.

## Limitations

Since this is an alias to `registry search`, it only supports basic search functionality. Advanced filtering options like `--status`, `--type`, `--transport`, and `--format` are only available in the full [registry search](/commands/registry/search) command.

## Examples

### Basic Search

Search for database-related servers:

```bash
1mcp mcp search database
```

### Browse All Servers

List all available servers:

```bash
1mcp mcp search
```

## See Also

- **[registry search](/commands/registry/search)** - Full registry search command with advanced options
- **[registry commands](/commands/registry/)** - Complete registry command documentation
- **[mcp install](/commands/mcp/install)** - Install servers found through search
