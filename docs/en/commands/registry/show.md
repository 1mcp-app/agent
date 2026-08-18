---
title: registry show
description: Show one MCP registry entry.
---

# registry show

```bash
1mcp registry show <server-id> [options]
```

`server-id` is required and should be the exact ID returned by `registry search`.

## Options

- `--ver, -v <version>`: show a specific version.
- `--format <table|json|detailed>`: output format. Default: `detailed`.

## Examples

```bash
1mcp registry show io.github.containers/kubernetes-mcp-server
1mcp registry show io.github.containers/kubernetes-mcp-server --ver 1.0.0
1mcp registry show io.github.containers/kubernetes-mcp-server --format json
```

See [Registry Commands](/commands/registry/) for shared registry connection options.
