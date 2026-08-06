---
title: registry search
description: Search entries in the configured MCP registry.
---

# registry search

```bash
1mcp registry search [query] [options]
```

`query` is optional text matched against server names and descriptions.

## Options

- `--status <active|archived|deprecated|all>`: server status. Default: `active`.
- `--type <npm|pypi|docker>`: package registry type.
- `--transport <stdio|sse|http>`: transport type.
- `--limit <number>`: maximum result count. Default: `20`; values above `100` are capped.
- `--cursor <string>`: cursor from a previous response.
- `--format <table|list|json>`: output format. Default: `table`.

## Examples

```bash
1mcp registry search
1mcp registry search "file system"
1mcp registry search database --type npm --transport stdio --limit 5
1mcp registry search --status deprecated --format json
1mcp registry search --cursor next-page-cursor
```

The command does not support category, tag, regular-expression, exclusion, private-registry, or update filters.

See [Registry Commands](/commands/registry/) for the shared options and the other lookup commands.
