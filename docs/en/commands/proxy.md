---
title: Proxy Command
description: Use 1mcp proxy as the stdio compatibility bridge to a running 1MCP HTTP runtime.
head:
  - ['meta', { name: 'keywords', content: '1MCP proxy,stdio bridge,compatibility bridge,direct MCP,CLI mode' }]
  - ['meta', { property: 'og:title', content: '1MCP Proxy Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Bridge stdio-only MCP clients to a running 1MCP HTTP runtime with 1mcp proxy.',
      },
    ]
---

# Proxy Command

`1mcp proxy` is the compatibility bridge for stdio-only clients.

It connects a local stdio transport to a running `1mcp serve` HTTP runtime. It is useful when a client cannot talk to the HTTP MCP endpoint directly.

## Choose the Right Path

1MCP supports three different paths:

1. **CLI mode for agent loops**: recommended for Codex, Claude, and similar agent sessions.
2. **Direct HTTP MCP attachment**: recommended for MCP-native clients that can connect to the runtime directly.
3. **`proxy`**: use only when the client is limited to stdio.

`proxy` is not the main product experience. It exists so older or stdio-only clients can still use the same runtime.

## Synopsis

```bash
1mcp proxy [options]
```

## What `proxy` Does

- discovers a running `1mcp serve` instance
- forwards stdio MCP traffic to that runtime over HTTP
- can apply preset, filter, or tags selection before exposing the bridged inventory

The runtime still lives in `serve`. `proxy` does not replace it.

## Auto-Discovery

`proxy` can discover a running runtime in these ways:

1. user-supplied `--url`
2. PID-file-based discovery
3. localhost port scan fallback

If project config is present, `proxy` can also merge settings from `.1mcprc`.

## Project Configuration with `.1mcprc`

`.1mcprc` is useful when you repeatedly bridge a stdio-only client to the same preset or filtered runtime view.

Example:

```json
{
  "preset": "development"
}
```

Priority order is:

1. command-line options
2. `.1mcprc`
3. defaults

## Common Options

### Connection

- **`--url, -u <url>`**: Override runtime auto-discovery.
- **`--config-dir, -d <path>`**: Use a specific config directory during discovery.

### Exposure control

- **`--preset, -P <name>`**: Select a preset from the running runtime.
- **`--filter, -f <expression>`**: Apply a filter expression.
- **`--tags <tags>`**: Apply simple comma-separated tags.

### Logging

- **`--log-level <level>`**: Set logging verbosity.
- **`--log-file <path>`**: Write logs to a file.

## Examples

### Appropriate use: stdio-only compatibility

```bash
# shell 1
1mcp serve

# shell 2
1mcp proxy
```

### Appropriate use: bridge to a preset

```bash
1mcp proxy --preset development
```

### Appropriate use: bridge to a discovered runtime with filtering

```bash
1mcp proxy --filter "web AND api"
```

### Prefer CLI mode instead of `proxy`

If the client is an agent session, prefer:

```bash
1mcp cli-setup --codex
# or
1mcp cli-setup --claude --scope repo --repo-root .
```

Then let the agent use:

```bash
1mcp instructions
1mcp inspect <server>
1mcp inspect <server>/<tool>
1mcp run <server>/<tool> --args '<json>'
```

### Prefer direct HTTP instead of `proxy`

If the client can talk to HTTP MCP directly, point it at the runtime endpoint rather than adding a local stdio bridge:

```text
http://127.0.0.1:3050/mcp?app=cursor
```

## Authentication Caveat

This is the most important limitation on this page:

- stdio transport does not give a client an OAuth browser flow
- `proxy` does not magically make a stdio-only client auth-capable
- if your runtime requires auth, a stdio-only client may still be unable to use it

In practice:

- use CLI mode for agent loops whenever possible
- use direct HTTP for clients that can authenticate
- use `proxy` for compatibility when auth requirements and client limitations actually allow it

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)**
- **[Serve Command](./serve.md)**
- **[Architecture](../reference/architecture.md)**
