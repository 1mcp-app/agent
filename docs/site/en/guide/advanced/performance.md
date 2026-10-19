---
title: Performance and Recovery
description: Configure bounded stdio backend recovery and use 1MCP operational signals accurately.
head:
  - ['meta', { name: 'keywords', content: '1MCP stdio recovery,restartOnExit,maxRestarts,health checks' }]
  - ['meta', { property: 'og:title', content: '1MCP Performance and Recovery' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Configure bounded stdio backend recovery and use 1MCP logs and health routes for operations.',
      },
    ]
---

# Performance and Recovery

1MCP forwards MCP traffic to the configured backend. Size connection and request timeouts for each backend, then use logs and health routes to investigate slow or unavailable services. It does not provide load balancing, a circuit breaker, connection pooling, or an uptime guarantee.

## Bounded Stdio Recovery

Automatic recovery is opt-in and applies only to `stdio` backend servers. Set `restartOnExit` in `mcp.json` when a child process should be supervised after it exits:

```json
{
  "mcpServers": {
    "local-tool": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "restartOnExit": true,
      "maxRestarts": 5,
      "restartDelay": 1000
    }
  }
}
```

`maxRestarts` is the maximum number of consecutive restart attempts; omit it for `5`, use `0` for no limit, or set a positive bound. After five stable minutes, the attempt counter resets. `restartDelay` is the initial delay in milliseconds. Consecutive failures wait 1x, 2x, 4x, 8x, then at most 16x that delay.

HTTP, SSE, and streamable HTTP backend entries ignore these supervision settings. Recovery does not promise that a failed backend is available, so callers must still handle MCP errors and check their intended service before critical work.

## Operational Signals

- Use `/health/ready` to determine whether the HTTP runtime can accept traffic. It does not mean every backend is ready.
- Use `/health/mcp` to observe backend loading and retry progress.
- Use the authenticated `inspect` API or `1mcp inspect` for the client-facing state before invoking a known backend.
- Configure `ONE_MCP_LOG_LEVEL=debug` while investigating an incident, then return it to the appropriate production level.

For startup behavior and catalog publication, see [Fast Startup](/guide/advanced/fast-startup). For the server configuration contract, see [MCP Servers Reference](/reference/mcp-servers).
