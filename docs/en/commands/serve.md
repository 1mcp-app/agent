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
- provide a runtime for `1mcp proxy` to bridge stdio-compatible clients with project context

CLI mode depends on a running `serve` instance.

## Current Mental Model

`serve` is not just a transport switch. It is the main runtime process.

- Static servers are created from startup configuration.
- Template servers are created later per client or session.
- Async loading can start HTTP availability before all servers finish loading.
- Lazy loading can keep server exposure narrower until needed.
- Instruction aggregation and preset notifications are initialized inside this runtime.

For runtime-wide configuration details, see the **[Configuration Guide](/guide/essentials/configuration)**.

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

### Lifecycle

- **`--background`**: Start a persistent Background Runtime Supervisor and its HTTP Aggregated Runtime for the selected **Runtime Scope**, then return once the runtime is ready. HTTP only.
- **`--status`**: Report the state of the runtime in the selected **Runtime Scope**, then exit without starting a server.
- **`--stop`**: Stop the runtime in the selected **Runtime Scope**, then exit.
- **`--restart`**: Stop the runtime in the selected **Runtime Scope** (if running), then start a fresh detached background runtime. HTTP only.

## Runtime Scope and Lifecycle

A **Runtime Scope** is a configuration directory. Runtime uniqueness is scoped to the config directory, not the whole machine: the default config directory is the default Runtime Scope, and an alternate `--config-dir` is a separate Runtime Scope that can run its own runtime.

Each Runtime Scope has one race-safe lifecycle owner. An ordinary foreground or background `serve` command exits non-zero if that scope is already owned, including while a background runtime is restarting or in `crash-loop`. Use `--restart` when replacement is intentional. Different configuration directories remain independent.

Foreground HTTP and deprecated foreground stdio starts participate in the same ownership rule, but remain unsupervised. Prefer `1mcp proxy` for stdio-compatible clients; background mode is HTTP-only.

### Start in the background

`1mcp serve --background` starts a persistent supervisor with one detached runtime worker and returns once the worker is ready, so scripts can continue:

```bash
1mcp serve --background
1mcp serve --background --config-dir ./config --port 3051
```

While it waits, it prints live progress to stderr (elapsed time and, once the runtime is up, how many upstream servers are ready) so the startup is never silent. On success it prints the PID, URL, log file, and server count, then exits `0`:

```text
Background runtime started.
PID: 48213
URL: http://localhost:3050/mcp
Log file: /home/me/.config/1mcp/logs/server.log
Servers: 3/5 ready
```

Behavior:

- **HTTP only.** `--transport stdio` is rejected (stdio cannot be detached). `sse` is normalized to HTTP, and the runtime records `transport: http`.
- **Fast detach.** In the default synchronous mode the command returns only after every upstream server connects, so the wait scales with the slowest one. Add `--enable-async-loading` to bind the HTTP endpoint first and return in well under a second, with upstream servers loading in the background.
- **Deterministic logs.** When no `--log-file` or `logging.file` is configured, background logs default to `<config-dir>/logs/server.log`.
- **Exclusive startup.** If the Runtime Scope is already owned, the command exits non-zero without spawning another runtime worker or binding a port. Simultaneous starts have exactly one winner. A separate `--config-dir` is a separate scope and can run independently.
- **Crash recovery.** Every unexpected worker exit consumes an attempt. The supervisor retries up to five times after 1, 2, 4, 8, and 16 seconds, reusing the original effective configuration, transport, host, port, logging, and startup options.
- **Stable reset.** The retry counter resets only after a replacement reaches readiness and stays alive for five minutes.
- **Health is observational.** A live worker that later fails readiness is reported as unreachable; it is not killed or restarted solely because of health.
- **Terminal failure.** After retry exhaustion, the supervisor stays resident in `crash-loop` without a worker until `--stop` or `--restart`. The original background command exits non-zero if startup reaches this state.
- **Orphan handling.** If the supervisor dies while its worker remains alive, the scope is `orphaned`. Ordinary starts continue to fail closed; use `--stop` or `--restart` to recover it.
- **Stale ownership.** Valid ownership left by a dead process can be reclaimed. Unreadable, malformed, or otherwise ambiguous ownership fails closed.
- **Lifecycle logs.** Supervisor events append to the background log, including worker exit reason, attempt, delay, replacement PID, recovery, and retry exhaustion.

### Check runtime status

`1mcp serve --status` discovers the runtime occupying the selected Runtime Scope and reports it:

```bash
1mcp serve --status
1mcp serve --status --config-dir ./config
```

For a supervised background runtime it prints the supervisor and runtime PIDs, restart attempt, last exit, next retry, URL, start time, log file, and readiness:

```text
Runtime Scope: /home/me/.config/1mcp
Status: running
Supervisor PID: 48190
Runtime PID: 48213
Restart attempt: 0
Last exit: none
Next retry: none
URL: http://localhost:3050/mcp
Started: 2026-06-26T00:00:00.000Z
Log file: /home/me/.config/1mcp/logs/server.log
Process: alive
Readiness (/health/ready): ready
```

The exit code reflects the state, so scripts can branch on it:

- `0` — running and ready
- `3` — not running (the scope is empty, or a stale PID file pointing to a dead process was cleaned up)
- `4` — alive but not yet ready (the process is up but `/health/ready` is not passing, e.g. mid-startup)
- `5` — restarting after an unexpected worker exit
- `6` — `crash-loop` after automatic retries are exhausted
- `7` — orphaned (the supervisor is dead while its runtime worker remains alive)

Status does not restart or kill a live process. Stale dead metadata is cleaned up when it can be identified safely; live-but-unreachable and ambiguous ownership remain in place so the scope never appears falsely available.

### Stop the runtime

`1mcp serve --stop` stops only the runtime in the selected Runtime Scope:

```bash
1mcp serve --stop
1mcp serve --stop --config-dir ./config
```

For a background runtime it first stops the supervisor, which cancels pending retry work, and then ensures the worker exits before releasing lifecycle ownership. This ordering prevents a deliberate stop from spawning a replacement. It also recovers an orphan by stopping the surviving worker directly.

```text
Stopped supervised background runtime in Runtime Scope /home/me/.config/1mcp (supervisor PID 48190).
```

Behavior:

- **Scope-isolated.** Only the runtime recorded for the selected Runtime Scope is signalled; a runtime in a different `--config-dir` is never touched.
- **No respawn.** A pending retry is cancelled before the worker is stopped, and ownership is released only after supervisor and worker termination.
- **Orphan recovery.** A dead supervisor with a live worker is stopped and its stale lifecycle metadata is released.
- **Clean when idle.** If nothing is running it reports so and exits `0`, removing stale metadata when it is safe to do so.

### Restart the runtime

`1mcp serve --restart` stops the runtime in the selected Runtime Scope (if any) and then starts a fresh detached background runtime:

```bash
1mcp serve --restart
1mcp serve --restart --config-dir ./config --port 3051
```

It composes `--stop` and `--background`, so it accepts the same HTTP options as `--background` and prints the same startup progress and started report.

Behavior:

- **Always ends running.** Following `systemctl restart` semantics, an empty scope is a clean no-op stop followed by a cold start, so a successful restart always leaves a runtime running and exits `0`.
- **Resets supervision.** Restart works from running, restarting, `crash-loop`, and orphaned states. It replaces both supervisor and worker and resets the retry counter.
- **HTTP only.** Like `--background`, `--transport stdio` is rejected.
- **Safe handoff.** If the existing runtime cannot be stopped (still alive after escalation), the restart aborts before starting and exits non-zero, so two runtimes never contend for the same scope.

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

Use this when the client can authenticate against the HTTP runtime. Do not assume stdio clients that cannot complete HTTP auth will work through `proxy` in this configuration.

## Related Commands

- **`1mcp cli-setup --codex`**
- **`1mcp cli-setup --claude --scope repo --repo-root .`**
- **`1mcp instructions`**
- **`1mcp inspect <server>`**
- **`1mcp inspect <server>/<tool>`**
- **`1mcp run <server>/<tool> --args '<json>'`**
- **`1mcp proxy`**

## See Also

- **[CLI Mode Guide](/guide/integrations/cli-mode)**
- **[Proxy Command](/commands/proxy)**
- **[Cloud Deployment with Caddy](/guide/advanced/cloud-deployment)**
- **[Architecture](/reference/architecture)**
- **[Configuration Guide](/guide/essentials/configuration)**
