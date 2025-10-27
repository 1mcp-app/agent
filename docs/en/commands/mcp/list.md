---
title: MCP List Command - List Configured Servers
description: List all configured MCP servers in 1MCP. View server details, status, tags, and configuration information.
head:
  - ['meta', { name: 'keywords', content: 'mcp list command,list servers,server details,tags,configuration' }]
  - ['meta', { property: 'og:title', content: '1MCP List Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'List all configured MCP servers in 1MCP. View server details and status.',
      },
    ]
---

# mcp list

Lists all configured MCP servers.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
npx -y @1mcp/agent mcp list [options]
```

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--tags <tags>`**
  - Filter the list to only show servers with the specified comma-separated tags.

- **`--show-disabled`**
  - Include disabled servers in the list.

- **`--show-secrets`**
  - Display sensitive information such as command arguments, URLs, and environment variables. By default, sensitive data is redacted for security.

- **`--verbose`**
  - Show detailed information, including headers and environment variables.

## Examples

```bash
# List all enabled servers
npx -y @1mcp/agent mcp list

# List all servers, including disabled ones
npx -y @1mcp/agent mcp list --show-disabled

# List all servers with the "prod" tag
npx -y @1mcp/agent mcp list --tags=prod

# Show detailed information for all servers (verbose mode)
npx -y @1mcp/agent mcp list --verbose

# Show detailed information including sensitive data
npx -y @1mcp/agent mcp list --verbose --show-secrets
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
