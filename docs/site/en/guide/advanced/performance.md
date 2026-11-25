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

## Backend Sleep

Backend Sleep is opt-in for each static `stdio` server. It releases an idle owned process while keeping last-known capabilities discoverable. Waking starts a fresh backend session: process-local state is lost and the first operation pays initialization latency. Enable it only when you accept those effects, including the fact that 1MCP cannot observe work hidden entirely inside the backend.

```json
{
  "mcpServers": {
    "local-tool": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "sleep": { "enabled": true, "idleTimeoutMs": 300000 }
    }
  }
}
```

Omit `sleep` to preserve existing behavior. `enabled` is required when the object is present. `idleTimeoutMs` defaults to `300000` and must be an integer from `1` to `2147483647`; `0` does not disable the timer. Eligibility is checked every `30000` ms, so release can occur after the threshold. This policy is per server, not a `serverDefaults` setting. Template Servers keep their existing pool cleanup, and remote HTTP/SSE servers do not support this policy.

Backends initialize normally at runtime startup. The idle window starts after initialization and capability refresh, or after the last tracked operation completes. Connected inactive clients do not block sleep. Outstanding requests, subscriptions, asynchronous tasks, and uncertain upstream completion do; caller timeout or cancellation does not establish completion.

Discovery and status reads use cached metadata without waking or extending the idle window. Tool calls, resource reads, prompt retrieval, subscriptions, and explicit refresh wake the backend. Lazy loading remains independent:

| Lazy loading | Sleep | Behavior                                                               |
| ------------ | ----- | ---------------------------------------------------------------------- |
| Off          | Off   | Existing direct tools and process lifetime                             |
| On           | Off   | Existing meta-tools and process lifetime                               |
| Off          | On    | Cached direct tools remain advertised; calls wake the backend          |
| On           | On    | `tool_list` and `tool_schema` use cached metadata; `tool_invoke` wakes |

Cached capabilities remain subject to current permissions, filters, and disabled-tool/server settings. After wake, 1MCP refreshes capabilities and validates the operation again. Concurrent callers share one startup attempt; each retains its own cancellation and deadline. Wake errors are returned without replay. Failure imposes a `30000` ms cooldown; a later request may retry, but cooldown expiry alone does not start a process.

If the first capability refresh fails, the original backend stays connected and usable, but `capability-discovery-failed` blocks sleep. Restart the backend or replace its configuration to retry sleep initialization; an ordinary forced discovery refresh does not clear this blocker.

Configuration reload applies policy changes: enabling sleep or changing the timeout starts a fresh idle window; disabling sleep wakes a sleeping backend. Server disable/removal and runtime shutdown take precedence. Intentional sleep does not consume the crash-recovery budget or trigger automatic restart supervision.

Only verified exclusively owned processes can be terminated. Uncertain ownership blocks sleep, and failed release blocks replacement. Shared daemons keep their own lifecycle; releasing a connection does not reclaim all daemon memory. CLI/Admin status shows lifecycle state, last activity, timeout, blockers, and wake or release failures. Platform-specific process-release evidence belongs to the release's test results; configuration acceptance alone does not prove reclamation.

## Operational Signals

- Use `/health/ready` to determine whether the HTTP runtime can accept traffic. It does not mean every backend is ready.
- Use `/health/mcp` to observe backend loading and retry progress.
- Use the authenticated `inspect` API or `1mcp inspect` for the client-facing state before invoking a known backend.
- Configure `ONE_MCP_LOG_LEVEL=debug` while investigating an incident, then return it to the appropriate production level.

For startup behavior and catalog publication, see [Fast Startup](/guide/advanced/fast-startup). For the server configuration contract, see [MCP Servers Reference](/reference/mcp-servers).
