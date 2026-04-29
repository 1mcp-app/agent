---
title: Proxy Command
description: Use 1mcp proxy as the maximum-compatibility bridge to a running 1MCP HTTP runtime.
head:
  - ['meta', { name: 'keywords', content: '1MCP proxy,stdio bridge,maximum compatibility,direct MCP,CLI mode' }]
  - ['meta', { property: 'og:title', content: '1MCP Proxy Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Bridge stdio-compatible MCP clients to a running 1MCP HTTP runtime with 1mcp proxy.',
      },
    ]
---

# Proxy Command

`1mcp proxy` is the maximum-compatibility bridge on top of a running 1MCP runtime.

It connects a local stdio transport to a running `1mcp serve` HTTP runtime. In practice, this is the preferred fallback after CLI mode because most AI clients already support stdio, while fewer support streamable HTTP, SSE, or CLI mode.

## Choose the Right Path

1MCP supports three different paths:

1. **CLI mode for agent loops**: recommended for Codex, Claude, and similar agent sessions.
2. **`proxy`**: recommended when you want the broadest client compatibility while keeping project context.
3. **Direct streamable HTTP MCP attachment**: use when the client can connect directly and you do not need project context.

`proxy` is not the main product experience. CLI mode remains the first choice for agent loops. `proxy` exists as the best non-CLI path when you want stdio compatibility plus `.1mcprc` and template-server support.

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

`.1mcprc` is useful when you repeatedly bridge the same project or client to the same preset or filtered runtime view.

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

### Appropriate use: maximum-compatibility stdio path

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

### Use direct HTTP only when project context is unnecessary

If the client can talk to streamable HTTP MCP directly and you do not need project context, point it at the runtime endpoint:

```text
http://127.0.0.1:3050/mcp?app=cursor
```

## Authentication Caveat

This is the most important limitation on this page:

- stdio transport does not give a client an OAuth browser flow
- `proxy` does not magically make a stdio client auth-capable
- if your runtime requires auth, a client that cannot complete HTTP auth cannot use it through `proxy`

In practice:

- use CLI mode for agent loops whenever possible
- use direct HTTP for clients that can authenticate and do not need project context
- use `proxy` only with runtimes that do not require auth
- run a separate unauthenticated `serve` instance if a stdio client still needs compatibility access

## See Also

- **[CLI Mode Guide](/guide/integrations/cli-mode)**
- **[Serve Command](/commands/serve)**
- **[Architecture](/reference/architecture)**
