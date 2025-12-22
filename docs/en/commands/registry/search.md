---
title: Registry Search Command - Server Discovery
description: Search the 1MCP registry for MCP servers by name, category, tags, or functionality. Filter results and find servers that match your specific requirements.
head:
  - ['meta', { name: 'keywords', content: 'MCP registry search,server discovery,filtering,server lookup' }]
  - ['meta', { property: 'og:title', content: '1MCP Registry Search Command - Server Discovery' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Search the 1MCP registry for MCP servers with advanced filtering and discovery capabilities.',
      },
    ]
---

# registry search

Search the 1MCP registry for MCP servers using various filters and criteria. Find servers by name, category, tags, or functionality with advanced filtering options.

## Synopsis

Search for servers by name or keyword:

```bash
npx -y @1mcp/agent registry search <query>
```

Browse all available servers:

```bash
npx -y @1mcp/agent registry search
```

Filter by transport type:

```bash
npx -y @1mcp/agent registry search --transport=stdio
```

Advanced filtering with multiple criteria:

```bash
npx -y @1mcp/agent registry search database --type=npm --format=json
```

## Arguments

`<query>` (optional)
: Search query string to match against server names, descriptions, and tags. Supports partial matching and fuzzy search.

## Global Options

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--status <status>`**
  - Filter by server status
  - **Choices**: `active`, `archived`, `deprecated`, `all`
  - **Default**: `active`

- **`--type <type>`**
  - Filter by package registry type
  - **Choices**: `npm`, `pypi`, `docker`

- **`--transport <transport>`**
  - Filter by transport method
  - **Choices**: `stdio`, `sse`, `http`

- **`--limit <number>`**
  - Maximum number of results to return
  - **Default**: `20`
  - **Maximum**: `100`

- **`--cursor <string>`**
  - Pagination cursor for retrieving next page of results

- **`--format <format>`**
  - Output format for search results
  - **Choices**: `table`, `list`, `json`
  - **Default**: `table`

## Examples

### Basic Search

Search for filesystem-related servers:

```bash
npx -y @1mcp/agent registry search filesystem
```

### Filter by Transport

Find servers that use stdio transport:

```bash
npx -y @1mcp/agent registry search --transport=stdio
```

### Filter by Package Type

Search for npm packages only:

```bash
npx -y @1mcp/agent registry search --type=npm database
```

### Limit Results

Get only the first 5 results:

```bash
npx -y @1mcp/agent registry search database --limit=5
```

### JSON Output

Get machine-readable results:

```bash
npx -y @1mcp/agent registry search database --format=json
```

### List All Active Servers

Browse all available servers:

```bash
npx -y @1mcp/agent registry search --status=active
```

## Search Syntax

### Query Format

Search queries support flexible matching:

```bash
# Exact name match
registry search filesystem

# Partial name match
registry search file

# Description match
registry search "file system"

# Tag match
registry search storage

# Fuzzy matching
registry search flsystm  # Matches "filesystem"
```

### Special Operators

Use special operators for advanced searches:

```bash
# Exact phrase match
registry search "file system access"

# Exclude terms
registry search database --not=mysql

# Wildcard matching
registry search py*  # Matches python, pytorch, etc.

# Regular expressions
registry search --regex="^(git|svn|hg)$"
```

## Categories and Tags

### Available Categories

- **System** - File system, backup, utilities
- **Database** - Database servers and clients
- **Development** - Build tools, version control
- **Web** - HTTP clients, web scraping
- **Network** - Network protocols, APIs
- **Storage** - Cloud storage, object storage
- **Communication** - Email, chat, notifications
- **Data Processing** - Analytics, ML, ETL
- **Security** - Authentication, encryption
- **Monitoring** - Logging, metrics, alerts

### Common Tags

- **Transport**: stdio, http, sse
- **Platform**: linux, darwin, win32, web
- **Functionality**: api, cli, gui, batch
- **Language**: python, javascript, go, rust
- **Environment**: development, production, testing
- **Security**: trusted, verified, sandboxed

## Sorting and Pagination

### Sort Options

```bash
# Sort by popularity (most downloaded)
registry search --sort=popularity

# Sort by recently updated
registry search --sort=updated

# Sort by name (alphabetical)
registry search --sort=name

# Sort by creation date
registry search --sort=created

# Sort by download count
registry search --sort=downloads
```

### Pagination

Control result display:

```bash
# Limit results
registry search --limit=10

# Skip first N results
registry search --offset=20

# Show all results (up to max 100)
registry search --limit=100
```

## Registry Caching

Search results are cached for performance:

```bash
# Force refresh cache
registry search --refresh

# Check cache status
registry status --cache

# Clear cache
registry cache --clear
```

## Integration Examples

### Pipeline to Install

Search and install servers:

```bash
# Search and install top result
registry search database --limit=1 --output=json | \
  jq -r '.results[0].name' | \
  xargs npx -y @1mcp/agent mcp install

# Install all database servers
registry search --category=database --output=list | \
  xargs -n1 npx -y @1mcp/agent mcp install
```

### Update Check Automation

Check for updates in scripts:

```bash
#!/bin/bash
# Check for servers with updates
updates=$(registry search --updates --output=json)
count=$(echo "$updates" | jq '.total')

if [ "$count" -gt 0 ]; then
  echo "Found $count available updates:"
  echo "$updates" | jq -r '.results[] | "  • \(.name): \(.current) → \(.latest)"'

  # Ask user if they want to update
  read -p "Update all servers? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    registry search --updates --output=list | \
      xargs -n1 npx -y @1mcp/agent mcp update
  fi
fi
```

## See Also

- **[mcp install](../mcp/install.md)** - Install servers from search results
- **[Server Management Guide](../../guide/essentials/server-management.md)** - Server management overview
