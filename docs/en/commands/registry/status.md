---
title: registry status
description: Check availability of the configured MCP registry.
---

# registry status

```bash
1mcp registry status [options]
```

## Options

- `--stats`: include server-count statistics. Default: `false`.
- `--json`: write the result as JSON. Default: `false`.

## Examples

```bash
1mcp registry status
1mcp registry status --stats
1mcp registry status --stats --json
```

See [Registry Commands](/commands/registry/) for shared registry connection options.
