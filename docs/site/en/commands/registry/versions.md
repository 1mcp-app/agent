---
title: registry versions
description: List versions available for one MCP registry entry.
---

# registry versions

```bash
1mcp registry versions <server-id> [options]
```

`server-id` is required and should be the exact ID returned by `registry search`.

## Options

- `--format <table|json|detailed>`: output format. Default: `table`.

## Examples

```bash
1mcp registry versions io.github.containers/kubernetes-mcp-server
1mcp registry versions io.github.containers/kubernetes-mcp-server --format detailed
1mcp registry versions io.github.containers/kubernetes-mcp-server --format json
```

See [Registry Commands](/commands/registry/) for shared registry connection options.
