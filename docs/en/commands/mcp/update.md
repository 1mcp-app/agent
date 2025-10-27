---
title: MCP Update Command - Modify Server Configuration
description: Update existing MCP server configurations in 1MCP. Modify server settings, transport types, and configuration options without removing and re-adding.
head:
  - ['meta', { name: 'keywords', content: 'mcp update,update server,modify configuration,edit MCP,server settings' }]
  - ['meta', { property: 'og:title', content: '1MCP Update Command Reference' }]
  - ['meta', { property: 'og:description', content: 'Update existing MCP server configurations in 1MCP.' }]
---

# mcp update

Updates the configuration of an existing MCP server.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
# Standard syntax
npx -y @1mcp/agent mcp update <name> [options]

# Quick syntax with " -- " pattern (updates command and args)
npx -y @1mcp/agent mcp update <name> [options] -- <command> [args...]
```

## Arguments

- **`<name>`**
  - The name of the server to update.
  - **Required**: Yes

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--tags <tags>`**
  - A new comma-separated list of tags. This will overwrite the existing tags.

- **`--env <key=value>`**
  - Add or update an environment variable. Can be specified multiple times.

- **`--timeout <ms>`**
  - A new connection timeout in milliseconds.

- **`--type <type>`**
  - Change the transport type for the server.
  - **Values**: `stdio`, `http`, `sse`

- **`--command <command>`**, **`--args <args>`**, **`--url <url>`**
  - You can also update the core properties of the server.

- **`--cwd <path>`**
  - Update the working directory for `stdio` servers.

- **`--headers <key=value>`**
  - Update HTTP headers for `http`/`sse` servers. Can be specified multiple times.

- **`--restart-on-exit`**
  - Enable or disable automatic restart when the process exits (for `stdio` servers only).

- **`--max-restarts <number>`**
  - Update the maximum number of restart attempts (for `stdio` servers only).

- **`--restart-delay <ms>`**
  - Update the delay in milliseconds between restart attempts (for `stdio` servers only).

## Examples

### Standard Syntax

```bash
# Update the tags for a server
npx -y @1mcp/agent mcp update my-server --tags="new-tag,another-tag"

# Update an environment variable
npx -y @1mcp/agent mcp update my-stdio-server --env="NODE_ENV=production"

# Change the URL of an HTTP server
npx -y @1mcp/agent mcp update my-http-server --url="https://new.api.com/mcp"
```

### Quick " -- " Pattern Syntax

```bash
# Update server command using " -- " pattern
npx -y @1mcp/agent mcp update my-server -- npx -y updated-package

# Update command while preserving environment variables and tags
npx -y @1mcp/agent mcp update airtable -- npx -y @airtable/mcp-server-v2

# Update with additional options
npx -y @1mcp/agent mcp update my-server --timeout=10000 -- node updated-server.js

# Update restart configuration
npx -y @1mcp/agent mcp update my-server --restart-on-exit --max-restarts=3 --restart-delay=1500

# Update working directory and HTTP headers
npx -y @1mcp/agent mcp update stdio-server --cwd=/new/path
npx -y @1mcp/agent mcp update http-server --headers="Authorization=Bearer newtoken" --timeout=5000
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
