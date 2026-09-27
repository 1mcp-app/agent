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

When supported, `inspect` uses the authenticated `/api/v1/inspect` endpoint first and falls back to the MCP protocol when needed. It reports startup states for configured static servers before the first capability snapshot; use [`wait`](/commands/wait) when a script must wait for `connected` with `available: true`.

This is the command that turns the broad inventory from `instructions` into a scoped view. First inspect one server, then inspect one tool, and only then move to execution.

## Targets

- **Omit target** - List all servers exposed by the running 1MCP instance
- **`<server>`** - List tools for one server
- **`<server>/<tool>`** - Inspect a single tool schema

## Options

### Connection and Filtering

- **`--url, -u <url>`** - Override auto-detected 1MCP server URL
- **`--context <name>`** - Use a named Runtime Target Context and its saved bearer token, if any
- **`--preset, -p <name>`** - Use a preset when querying the running server
- **`--tag-filter, -f <expression>`** - Apply an advanced tag filter expression
- **`--tags <tag>`** - Apply simple comma-separated tags

### Output and Pagination

- **`--format <toon|text|json>`** - Output format
- **`--all`** - Fetch all remaining tools for a server target or search
- **`--limit <number>`** - Page size for server tool listings and search results (default: `20`)
- **`--cursor <cursor>`** - Cursor returned from a previous paginated response

### Related Global Options

- **`--config-dir, -d <path>`** - Config directory for auth profile lookup and server discovery
- **`--cli-session-cache-path <path>`** - Override the session cache path template used by `inspect` and `run`; supports `{pid}` and `{scope}`

## Search for Tools

When the provider or tool is unknown, search the visible inventory before exact inspection:

```bash
1mcp inspect --search read
1mcp inspect filesystem --search read
1mcp inspect --search 'filesystem/*read?' --glob
1mcp inspect --search 'read a file' --include-descriptions
1mcp inspect --search read --show-descriptions --format json
# Read the selected server's applicable instructions, then inspect and invoke.
1mcp inspect filesystem
1mcp inspect filesystem/read_file
1mcp run filesystem/read_file --args '{"path":"README.md"}'
```

If the target is already known, inspect it directly. Reuse current startup instructions supplied by hooks; search does not replace applicable server instructions or exact schema inspection.

- **`--search <query>`** searches all visible servers, or only the specified server. Matching is case-insensitive literal substring matching against `server/tool` references.
- **`--glob`** opts into whole-reference matching with only `*` (zero or more characters) and `?` (one character) as wildcards. Quote patterns to avoid shell expansion; all other punctuation remains literal.
- **`--include-descriptions`** also matches effective descriptions, including configured overrides, using the selected matching mode. Each tool appears once even when both fields match.
- **`--show-descriptions`** independently includes descriptions in output; it does not change matching. Description matching alone keeps output compact.

Blank queries, exact-tool targets with search, and search-only flags without `--search` are invalid. Search preserves authentication, preset/tag filters, contextual template visibility, and disabled-tool rules.

Search returns `server`, `tool`, and required/optional argument counts without schemas. TOON is the default; text and JSON are also supported. Results are sorted by public server/tool identity and paginated after matching. `--limit` defaults to 20, and `--all` returns all remaining matches after an optional cursor. `totalTools` counts matches in the collected inventory, not all tools. Cursors bind the query, matching options, target, filters, and inventory; restart without a cursor if any change invalidates continuation.

A complete search with no matches succeeds. Check completeness and loading/unavailable metadata before concluding that a tool is absent. Partial inventories are not definitive absence; failed or malformed enumeration is reported. Use `1mcp wait <server>` for a loading static server. Cross-server search requires a runtime supporting inspect search; upgrade/restart an older runtime when directed. Server-scoped search may use the existing MCP fallback. Authentication failures remain terminal and do not trigger fallback.

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

### Inspect Through a Runtime Target Context

```bash
1mcp inspect --context prod filesystem/read_file
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
- Discover a tool’s server/tool command reference
- Review a tool's input and output schema before calling it
- Build scriptable automation using JSON output
- Keep the agent focused on one part of the tool surface at a time

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Why progressive server and tool inspection is recommended
- **[Instructions Command](./instructions.md)** - Start with the current CLI playbook and server inventory
- **[Run Command](./run.md)** - Call a tool after you have inspected its schema
- **[Serve Command](./serve.md)** - Start the 1MCP server that `inspect` queries
- **[Configuration Deep Dive](../guide/essentials/configuration.md)** - Global flags including CLI session cache configuration

### Tool output and pagination

CLI output identifies tools with `server` and `tool`; redundant `qualifiedName` / `qualified_name` display fields are omitted in text, JSON and TOON. API routing identities are unchanged.

`--limit` bounds the visible page even if the upstream server ignores pagination limits. `totalTools` is the complete currently visible inventory size; `hasMore` and `nextCursor` describe the remaining tools. Each inspection request collects upstream pages with a bounded walk (up to 1,000 pages) before applying local pagination. `--all` returns all remaining tools (all tools when no cursor is supplied). Cursors are tied to the target, filters and inventory. If a cursor is invalid or stale, restart without `--cursor`.
