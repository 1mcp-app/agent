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

Filter by category:

```bash
npx -y @1mcp/agent registry search --category=filesystem
```

Advanced filtering with multiple criteria:

```bash
npx -y @1mcp/agent registry search --tag=database --limit=10 --sort=popularity
```

## Arguments

`<query>` (optional)
: Search query string to match against server names, descriptions, and tags. Supports partial matching and fuzzy search.

## Global Options

--config-path `<path>`
: Path to a specific configuration file.

--config-dir `<path>`
: Path to the configuration directory containing `mcp.json`.

## Command-Specific Options

--category `<category>`
: Filter by server category (filesystem, database, development, etc.).

--tag `<tag>`
: Filter by specific tag. Can be used multiple times.

--maintainer `<maintainer>`
: Filter by maintainer name or organization.

--platform `<platform>`
: Filter by supported platform (linux, darwin, win32).

--transport `<transport>`
: Filter by transport type (stdio, http, sse).

--limit `<number>`
: Limit number of results (default: 20, max: 100).

--sort `<sort-method>`
: Sort results by: name, popularity, updated, created, downloads.

--order `<order>`
: Sort order: asc or desc (default: desc).

--installed
: Show only installed servers.

--updates
: Show only servers with available updates.

--trusted
: Show only trusted/verified servers.

--output `<format>`
: Output format: table, json, list (default: table).

--refresh
: Force refresh of registry cache before searching.

--detailed
: Show detailed server information in results.

## Examples

### Basic Search

Search for filesystem-related servers:

```bash
npx -y @1mcp/agent registry search filesystem

# Output:
# 🔍 Search Results: "filesystem"
#
# Name              | Category    | Version | Description
# ----------------- | ----------- | ------- | -----------------------------------------
# filesystem        | System      | 1.2.0   | File system access and management
# ftp               | Network     | 1.0.1   | FTP/SFTP file operations
# cloud-storage     | Storage     | 2.1.0   | Cloud storage integration (S3, GCS)
# backup            | System      | 1.5.2   | File backup and synchronization
#
# Found 4 results (showing 4 of 4)
```

### Category-Based Search

Find all database-related servers:

```bash
npx -y @1mcp/agent registry search --category=database

# Output:
# 🗃️  Database Servers
#
# Name              | Maintainer          | Version | Downloads | Description
# ----------------- | ------------------- | ------- | --------- | -------------------------
# postgresql        | MCP Team            | 2.0.1   | 15.2k     | PostgreSQL database operations
# mongodb           | MongoDB MCP         | 1.3.0   | 8.7k      | MongoDB database access
# mysql             | MySQL Community     | 1.8.2   | 12.1k     | MySQL database connectivity
# redis             | Redis Labs          | 1.2.1   | 9.4k      | Redis cache operations
# sqlite            | SQLite Team         | 2.1.0   | 18.3k     | SQLite database management
#
# Found 5 results
```

### Tag Filtering

Search for servers with specific tags:

```bash
npx -y @1mcp/agent registry search --tag=api --tag=rest

# Output:
# 🔍 Servers tagged with: api, rest
#
# Name              | Category    | Version | Description
# ----------------- | ----------- | ------- | -----------------------------------------
# http-client       | Network     | 1.5.0   | HTTP/REST API client
# api-gateway       | Development | 1.2.1   | API gateway and management
# rest-tools        | Development | 1.0.3   | REST API development tools
# web-scraping      | Web         | 2.0.1   | Web scraping for REST APIs
#
# Found 4 results
```

### Advanced Filtering

Combine multiple filters for precise results:

```bash
npx -y @1mcp/agent registry search \
  --category=development \
  --platform=linux \
  --transport=stdio \
  --trusted \
  --sort=popularity \
  --limit=5

# Output:
# 🔍 Development Servers (Linux, stdio, trusted)
#
# Name              | Version | Downloads | Description
# ----------------- | ------- | --------- | -----------------------------------------
# git               | 3.1.0   | 25.4k     | Git repository operations
# docker            | 2.0.1   | 18.7k     | Docker container management
# npm               | 1.8.0   | 14.2k     | Node.js package management
# python            | 2.2.1   | 16.9k     | Python development tools
# terraform         | 1.5.0   | 9.8k      | Terraform infrastructure
#
# Found 5 of 23 total results
```

### Installed Servers

Show only servers you have installed:

```bash
npx -y @1mcp/agent registry search --installed

# Output:
# 📦 Installed Servers
#
# Name              | Installed | Latest | Status   | Description
# ----------------- | --------- | ------ | -------- | -------------------------
# filesystem        | 1.2.0     | 1.2.1  | ⬆️ Update| File system access
# git               | 3.1.0     | 3.1.0  | ✓ Current| Git operations
# search            | 1.0.2     | 1.1.0  | ⬆️ Update| Web search capability
#
# 3 servers installed, 2 have updates available
```

### Servers with Updates

Find servers that can be updated:

```bash
npx -y @1mcp/agent registry search --updates

# Output:
# 🔄 Available Updates
#
# Server       | Current | Latest | Type      | Changes
# ------------ | ------- | ------ | --------- | ------------------------
# filesystem   | 1.2.0   | 1.2.1  | Patch     | Bug fixes, performance
# search       | 1.0.2   | 1.1.0  | Minor     | New features, API
# database     | 2.0.1   | 3.0.0  | Major     | Breaking changes, new API
#
# 3 updates available
```

### JSON Output

Get machine-readable results:

```bash
npx -y @1mcp/agent registry search database --output=json

# Output:
# {
#   "query": "database",
#   "total": 5,
#   "results": [
#     {
#       "name": "postgresql",
#       "displayName": "PostgreSQL Server",
#       "description": "PostgreSQL database operations and queries",
#       "version": "2.0.1",
#       "category": "Database",
#       "tags": ["database", "postgresql", "sql"],
#       "maintainer": "MCP Team",
#       "downloads": 15200,
#       "trustLevel": "verified",
#       "platforms": ["linux", "darwin", "win32"],
#       "transport": ["stdio"],
#       "lastUpdated": "2024-01-10T15:30:00Z"
#     }
#   ]
# }
```

### Detailed Output

Show comprehensive server information:

```bash
npx -y @1mcp/agent registry search git --detailed --limit=1

# Output:
# 🔍 Detailed: git
#
# Git Repository Operations Server
# =================================
#
# Version: 3.1.0
# Category: Development
# Maintainer: MCP Team
# License: MIT
#
# Description:
#   Provides Git repository operations including commit, branch, merge,
#   and file history management. Supports local and remote repositories.
#
# Capabilities:
#   • Tools: git_status, git_add, git_commit, git_push, git_pull, git_branch
#   • Resources: repository files, git history
#
# Requirements:
#   • Git command-line tools
#   • Read access to repository files
#   • Write permissions for repository modifications
#
# Platforms: Linux, macOS, Windows
# Transport: stdio
# Downloads: 25,400
# Last Updated: 2024-01-12
#
# Installation:
#   npx -y @1mcp/agent mcp install git
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
