---
title: Choosing an MCP Connection Model
description: Compare direct connections, a self-managed 1MCP runtime, and custom or managed proxies.
---

# Choosing an MCP Connection Model

Choose based on who owns configuration, routing, and operations. Server count alone does not determine the right approach.

## Compare responsibilities

| Approach               | Useful when                                                                      | Responsibilities and tradeoffs                                                                           |
| ---------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Direct MCP connections | Your client already manages the backends you need                                | Configure and authenticate each connection using the client's supported features; no extra proxy process |
| 1MCP                   | You want a shared inventory, filtering, CLI discovery, or project-aware backends | Operate the runtime and its backends, secure access, and verify client compatibility                     |
| Custom proxy           | You need behavior existing implementations cannot provide                        | Implement, test, secure, and maintain the required protocol and routing behavior                         |
| Managed proxy          | You want a provider to operate part of the infrastructure                        | Verify the specific provider's features, data handling, pricing, support, and service commitments        |

This is a comparison of architectural choices, not a benchmark or vendor survey. It does not establish cost savings, setup times, uptime, or certification.

## What 1MCP provides

- A unified MCP endpoint and [CLI workflow](/guide/integrations/cli-mode).
- Shared [server configuration](/reference/mcp-servers), hot reload, and [filtering](/guide/advanced/server-filtering).
- [OAuth and access controls](/guide/advanced/authentication).
- [Project-aware templates](/guide/project-checkouts) and explicit [backend preparation](/guide/backend-preparation).
- [Health endpoints](/reference/health-check), logs, and opt-in [STDIO recovery](/guide/advanced/performance).

The proxy adds a process and a network or transport hop. Local STDIO backends still run as child processes; aggregation does not eliminate their memory or CPU needs. 1MCP does not provide connection pooling, distributed clustering, or an uptime SLA. Compatibility must be checked against the clients, protocol features, and backends you actually use.

## Evaluate with one backend

1. Follow the [Quick start](/guide/quick-start) with one trusted backend.
2. Confirm that the intended client can discover and invoke its capabilities.
3. Check authentication, filtering, failure handling, and resource use for your workload.
4. Add more backends only after the first path works.

For existing desktop configurations, see [App consolidation](/guide/integrations/app-consolidation). Retain a rollback path and verify the replacement connection before removing the previous setup.
