---
title: Internal Installation Tools
description: Input and output lookup for the internal MCP installation tools.
head:
  - [
      'meta',
      { name: 'keywords', content: '1MCP installation tools,mcp_install,mcp_uninstall,mcp_update,MCP tool schema' },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Internal Installation Tools' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Input and output reference for the 1MCP mcp_install, mcp_uninstall, and mcp_update tools.',
      },
    ]
---

# Installation Tools

These tools modify MCP server configuration. Query their exact schemas with `tools/list` before invoking them.

## mcp_install

Required input:

- `name`: local MCP server configuration name.

Optional inputs:

- `version`, `package`, `command`, `args`, `url`, `transport` (`stdio`, `sse`, or `http`), `tags`, `env`.
- `force` (default `false`), `backup` (default `true`), `enabled` (default `true`), `autoRestart` (default `false`).
- `registryId`, `installationMethod` (`package` or `remote`), and `prerequisites` when known.

For a direct stdio package install, use `name`, `package`, `command`, and `args`:

```json
{
  "name": "project-dependencies",
  "package": "@scope/project-mcp",
  "command": "npx",
  "args": ["-y", "@scope/project-mcp"]
}
```

The result includes `name`, `status`, and `message`, and may include `package`, `version`, `configPath`, `backupPath`, `warnings`, `reloadRecommended`, and `error`.

## mcp_uninstall

Required input: `name`. Optional booleans are `preserveConfig` (default `false`), `force` (default `false`), `graceful` (default `true`), `backup` (default `true`), and `removeAll` (default `false`).

## mcp_update

Required input: `name`. Optional inputs are `version`, `package`, `autoRestart` (default `true`), `backup` (default `true`), `force` (default `false`), and `dryRun` (default `false`).

See [Internal Tools](/reference/internal-tools/) and [MCP CLI commands](/commands/mcp/).
