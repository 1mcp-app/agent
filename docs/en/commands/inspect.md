---
title: Inspect Command - Discover Servers and Tool Schemas
description: Use the inspect command to list servers, inspect a server's tools, and view tool schemas from a running 1MCP serve instance.
head:
  - ['meta', { name: 'keywords', content: '1MCP inspect command,tool schema,server discovery,MCP inspection' }]
  - ['meta', { property: 'og:title', content: '1MCP Inspect Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Inspect servers, tools, and tool schemas through a running 1MCP serve instance.',
      },
    ]
---

# Inspect Command

Inspect servers or tools from a running 1MCP `serve` instance.

## Synopsis

```bash
npx -y @1mcp/agent inspect [target] [options]
```

## Description

The `inspect` command is the discovery and schema step in the CLI workflow. Use it after [`instructions`](./instructions.md) and before [`run`](./run.md).

Depending on the target, `inspect` can:

- List all exposed servers when no target is provided
- List the exposed tools for a server when the target is `<server>`
- Show a readable tool schema summary when the target is `<server>/<tool>`

When supported, `inspect` uses the fast `/api/inspect` endpoint first and falls back to the MCP protocol when needed.

This is the command that turns the broad inventory from `instructions` into a scoped view. First inspect one server, then inspect one tool, and only then move to execution.

## Targets

- **Omit target** - List all servers exposed by the running 1MCP instance
- **`<server>`** - List tools for one server
- **`<server>/<tool>`** - Inspect a single tool schema

## Options

### Connection and Filtering

- **`--url, -u <url>`** - Override auto-detected 1MCP server URL
- **`--preset, -p <name>`** - Use a preset when querying the running server
- **`--tag-filter, -f <expression>`** - Apply an advanced tag filter expression
- **`--tags <tag>`** - Apply simple comma-separated tags

### Output and Pagination

- **`--format <toon|text|json>`** - Output format
- **`--all`** - Fetch all tools without pagination for a server target
- **`--limit <number>`** - Page size for server tool listings (default: `20`)
- **`--cursor <cursor>`** - Cursor returned from a previous paginated response

### Related Global Options

- **`--config-dir, -d <path>`** - Config directory for auth profile lookup and server discovery
- **`--cli-session-cache-path <path>`** - Override the session cache path template used by `inspect` and `run`

## Examples

### List All Servers

```bash
npx -y @1mcp/agent inspect
```

### List a Server's Tools

```bash
npx -y @1mcp/agent inspect filesystem
```

### Inspect a Tool Schema

```bash
npx -y @1mcp/agent inspect filesystem/read_file
```

### Use JSON Output for Scripting

```bash
npx -y @1mcp/agent inspect filesystem --format json
```

### Fetch Every Tool for a Server

```bash
npx -y @1mcp/agent inspect filesystem --all
```

### Continue a Paginated Listing

```bash
npx -y @1mcp/agent inspect filesystem --limit 20 --cursor next-page-token
```

## When to Use Inspect

Use `inspect` when you need to:

- Confirm which servers are currently available
- Discover the exact qualified name of a tool
- Review a tool's input and output schema before calling it
- Build scriptable automation using JSON output
- Keep the agent focused on one part of the tool surface at a time

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Why progressive server and tool inspection is recommended
- **[Instructions Command](./instructions.md)** - Start with the current CLI playbook and server inventory
- **[Run Command](./run.md)** - Call a tool after you have inspected its schema
- **[Serve Command](./serve.md)** - Start the 1MCP server that `inspect` queries
- **[Configuration Deep Dive](../guide/essentials/configuration.md)** - Global flags including CLI session cache configuration
