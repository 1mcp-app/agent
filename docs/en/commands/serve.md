---
title: Serve Command
description: Start the main 1MCP runtime with 1mcp serve and use it for CLI mode, direct HTTP MCP clients, and template-aware runtime behavior.
head:
  - ['meta', { name: 'keywords', content: '1MCP serve,runtime,CLI mode,direct MCP,async loading,lazy loading' }]
  - ['meta', { property: 'og:title', content: '1MCP Serve Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Run the main 1MCP runtime with 1mcp serve and connect to it through CLI mode or direct HTTP MCP clients.',
      },
    ]
---

# Serve Command

`1mcp serve` starts the main 1MCP runtime.

It is the process that aggregates your configured MCP servers, exposes the HTTP MCP surface, initializes presets and instruction aggregation, and resolves template servers when client or session context becomes available.

## Synopsis

```bash
1mcp serve [options]
1mcp [options]
```

`serve` is the default command.

## When to Use `serve`

Use `serve` whenever you want to:

- run the aggregated 1MCP runtime
- power CLI mode for agents
- expose a direct HTTP MCP endpoint to MCP-native clients
- provide a runtime for `1mcp proxy` to bridge stdio-only clients

CLI mode depends on a running `serve` instance.

## Current Mental Model

`serve` is not just a transport switch. It is the main runtime process.

- Static servers are created from startup configuration.
- Template servers are created later per client or session.
- Async loading can start HTTP availability before all servers finish loading.
- Lazy loading can keep server exposure narrower until needed.
- Instruction aggregation and preset notifications are initialized inside this runtime.

For runtime-wide configuration details, see the **[Configuration Guide](../guide/essentials/configuration.md)**.

## Common Options

### Configuration

- **`--config, -c <path>`**: Specify a configuration file.
- **`--config-dir, -d <path>`**: Specify the config directory.

### HTTP runtime

- **`--port, -P <port>`**: Change the HTTP port. Default: `3050`.
- **`--host, -H <host>`**: Change the bind host. Default: `localhost`.
- **`--external-url <url>`**: Set the external base URL, usually for auth-related flows.

### Filtering and presets

- **`--filter, -f <expression>`**: Filter exposed servers with simple comma-separated tags or advanced boolean expressions.

### Security

- **`--enable-auth`**: Enable OAuth-backed auth on the runtime.
- **`--enable-enhanced-security`**: Enable additional security middleware.
- **`--trust-proxy <config>`**: Configure trusted reverse-proxy behavior.

### Runtime behavior

- **`--enable-async-loading`**: Start HTTP availability before all static servers finish loading.
- **`--enable-lazy-loading`**: Enable lazy loading behavior for exposed server capabilities.
- **`--enable-config-reload`**: Enable config reload handling.
- **`--enable-session-persistence`**: Enable HTTP session persistence.

## Examples

### Start the runtime

```bash
1mcp serve
```

### Agent workflow against a running runtime

```bash
# shell 1
1mcp serve

# shell 2
1mcp instructions
1mcp inspect context7
1mcp inspect context7/query-docs
1mcp run context7/query-docs --args '{"libraryId":"/mongodb/docs","query":"aggregation pipeline"}'
```

### Start with a specific config

```bash
1mcp serve --config ./mcp.json
1mcp serve --config-dir ./config
```

### Start with async and lazy loading

```bash
1mcp serve --enable-async-loading --enable-lazy-loading
```

### Start with filtered server exposure

```bash
1mcp serve --filter "web,api"
1mcp serve --filter "(web OR api) AND production"
```

### Start a runtime for direct HTTP MCP clients

```bash
1mcp serve --host 0.0.0.0 --port 3051
```

Then point an MCP-native client at:

```text
http://127.0.0.1:3051/mcp?app=cursor
```

### Start with auth

```bash
1mcp serve --enable-auth --external-url https://mcp.example.com
```

Use this when the client can authenticate against the HTTP runtime. Do not assume stdio-only clients will work through `proxy` in this configuration.

## Related Commands

- **`1mcp cli-setup --codex`**
- **`1mcp cli-setup --claude --scope repo --repo-root .`**
- **`1mcp instructions`**
- **`1mcp inspect <server>`**
- **`1mcp inspect <server>/<tool>`**
- **`1mcp run <server>/<tool> --args '<json>'`**
- **`1mcp proxy`**

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)**
- **[Proxy Command](./proxy.md)**
- **[Architecture](../reference/architecture.md)**
- **[Configuration Guide](../guide/essentials/configuration.md)**
