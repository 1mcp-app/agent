---
title: Production Operations
description: Plan deployment, configuration, readiness checks, and recovery for a self-managed 1MCP runtime.
---

# Production Operations

Operate 1MCP as a runtime that owns backend connections and, for local STDIO backends, child processes. Plan capacity for the proxy and those backends together. Hosting, upgrades, backups, monitoring, and recovery remain the operator's responsibility.

## Choose a deployment path

- [Cloud deployment](/guide/advanced/cloud-deployment) covers public HTTPS deployment with Caddy.
- [Reverse proxy](/guide/advanced/reverse-proxy) covers forwarding, public URLs, and proxy trust.
- [Windows Task Scheduler](/guide/advanced/windows-task-scheduler) covers unattended Windows startup.

Configure authentication and restrict network access before exposing the service. Trust only your actual reverse proxies; see [Security](/guide/advanced/security).

## Keep configuration and credentials separate

Backend definitions belong in `mcp.json`; runtime settings belong in `config.toml`. Explicit CLI options override `ONE_MCP_*` environment values, which override configuration defaults. See [Configuration](/guide/essentials/configuration).

A backend environment reference can look like this:

```json
{
  "mcpServers": {
    "database": {
      "command": "mcp-postgres",
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    }
  }
}
```

This example assumes the backend executable is installed and `DATABASE_URL` is supplied in the selected runtime's environment or supported environment file. Environment references do not fetch secrets from an external secret store. See [environment management](/reference/mcp-servers#advanced-environment-management) for file placement and inheritance.

## Check runtime and backend readiness separately

| Signal          | What it establishes                                                                  |
| --------------- | ------------------------------------------------------------------------------------ |
| `/health/live`  | The HTTP process responds to a liveness probe                                        |
| `/health/ready` | The runtime is ready to accept traffic; not every backend must be ready              |
| `/health/mcp`   | Backend loading diagnostics; detail-level filtering applies only to supervision data |
| `1mcp inspect`  | The selected client's visible capabilities and server state                          |

The `/health` response defaults to minimal detail. The diagnostic `/health/mcp` routes can still expose backend error messages and authorization URLs at that level and are not protected by MCP authentication. Restrict access to those routes at the network or reverse-proxy boundary. Use the [Health Check API](/reference/health-check) for exact response shapes, status codes, and probe examples. Configure your monitoring system to collect these signals and deliver alerts; this guide does not imply built-in alert webhooks.

Async loading can make the runtime available before every backend connects. Verify the backend needed by a task before invoking it. See [Fast startup](/guide/advanced/fast-startup).

## Plan recovery and updates

Use [backend logs](/guide/advanced/backend-logs) and [trace context](/guide/advanced/observability) to investigate failures. STDIO supervision is opt-in and bounded; see [Performance and recovery](/guide/advanced/performance). Failed tool calls are not made safe to replay merely because a backend restarted.

Before an upgrade, back up the selected configuration and plan how clients will reconnect. Verify runtime readiness, backend discovery, and a representative authorized operation after the update.

## Multiple instances

1MCP does not supply a distributed session store, cluster coordinator, or load balancer. Do not assume that a shared configuration file or sticky routing replicates OAuth state, project ownership, or backend connections. Treat each runtime as a separate operational scope and validate any external routing and recovery design before relying on it.
