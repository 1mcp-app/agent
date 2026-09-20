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
- **`--template-context-trust <verified|disabled|legacy>`**: Control whether request context may render template servers. Default: `verified`.
- **`--confirm-untrusted-template-context`**: Required with `legacy` when binding HTTP to a non-loopback host.

`verified` preserves zero-configuration template rendering for first-party local `run`, `inspect`, `wait`, and `proxy` clients. Unsigned remote or third-party clients still connect and use static servers, but their context cannot affect template `command`, `args`, `cwd`, or `env`. `legacy` restores the historical unsigned behavior and should be a temporary compatibility mode.

### Runtime behavior

- **`--enable-async-loading`**: Start HTTP availability before all static servers finish loading.
- **`--enable-lazy-loading`**: Opt into meta-tool exposure for progressive tool discovery. Omit it for full direct exposure.
- **`--enable-config-reload`**: Enable config reload handling.
- **`--enable-session-persistence`**: Enable HTTP session persistence.

### Lifecycle

- **`--background`**: Start a persistent Background Runtime Supervisor and its HTTP Aggregated Runtime for the selected **Runtime Scope**, then return after generation-bound activation. Backend readiness is reported separately. HTTP only.
- **`--status`**: Report the state of the runtime in the selected **Runtime Scope**, then exit without starting a server.
- **`--stop`**: Stop the runtime in the selected **Runtime Scope**, then exit.
- **`--restart`**: Cooperatively replace a compatible background supervisor and worker in the selected **Runtime Scope** using the invoking installation. An empty scope starts a background runtime. HTTP only.
- **`--drain-timeout <seconds>`**: Deadline for the reversible drain before replacement commits; default `30`. Expiry resumes the old runtime and aborts the upgrade.

## Runtime Scope and Lifecycle

A **Runtime Scope** is a configuration directory. Runtime uniqueness is scoped to the config directory, not the whole machine: the default config directory is the default Runtime Scope, and an alternate `--config-dir` is a separate Runtime Scope that can run its own runtime.

Each Runtime Scope has one race-safe lifecycle owner. An ordinary foreground or background `serve` command exits non-zero if that scope is already owned, including while a background runtime is restarting or in `crash-loop`. Use `--restart` when replacement is intentional. Different configuration directories remain independent.

Foreground HTTP and deprecated foreground stdio starts participate in the same ownership rule, but remain unsupervised. Prefer `1mcp proxy` for stdio-compatible clients; background mode is HTTP-only.

### Cooperative background ownership

Compatible background runtimes authenticate a scope-local supervisor control channel. Normal background launch, client attachment, status, stop, and cooperative restart do not require `ps`, `sysctl`, or equivalent OS process inspection. The supervisor controls its own worker through a private parent/child channel. Persisted PIDs and scope metadata alone never authorize signalling or takeover.

This path requires a responsive, compatible supervisor. It does not adopt orphaned workers or reclaim ambiguous ownership. An unreachable or incompatible owner retains its records and requires explicit migration or recovery through its original CLI or service manager. Foreground ownership and legacy recovery retain the process-identity rules below.

### Persistent volumes and legacy process identity

On Linux, lifecycle ownership uses kernel file locks; foreground and legacy recovery also use persisted process identity (boot ID, PID namespace, and process start time). The `flock` command must be available; the official Alpine-based Docker image includes it. The config directory must reside on storage that provides working, shared `flock` semantics. Missing locking support fails closed.

After a foreground Docker runtime is externally killed, a replacement container can reclaim its abandoned owner and stop records on the same persistent volume, even when both processes are PID 1. A different live container sharing that volume still holds the kernel lock and excludes a competing start. Changing the hostname alone never authorizes takeover.

The stable `runtime.owner.flock` and `runtime.stop.flock` files remain after shutdown. Their presence does not mean a lock is held. **Do not delete these files while any process may use the scope**: replacing their inodes would defeat coordination.

Foreground and legacy `server.pid`, ownership, and supervisor metadata record process birth evidence. Discovery and stop commands retain ambiguous metadata and refuse to signal an unverified process. Stop checks identity again before escalating from SIGTERM to SIGKILL.

Process-identity-based macOS records use the boot-session UUID and UTC process start time, so network-driven hostname changes do not block restart. Identity errors identify the affected PID and missing or mismatched evidence. Run lifecycle commands as the runtime user on the same host/container with process-inspection permissions. Legacy hostname records require a one-time verified stop through the original CLI or service manager if the hostname changed; the next start writes the current format. Do not delete metadata to bypass verification.

Legacy process-record compatibility is scheduled for removal in the next major release (1.0). Stop old runtimes before upgrading across that boundary; release notes and upgrade tests must cover this transition.

Compatibility and limits:

- **Upgrading a running legacy background runtime:** On Linux, explicit `serve --stop` can recover an old supervisor with a live worker when OS process evidence proves the exact ownership claim, parent relationship, user, execution context, and selected scope. Recovery checks the captured processes again before signals and cleanup, stops the supervisor first, and aborts if a different worker or owner appears. It does not rewrite old identity metadata. Legacy `serve --restart` requires guided migration; it does not take over the old owner. `serve --status` and client commands only provide recovery guidance.
- **Guided legacy recovery:** macOS and Windows, standalone old runtimes, supervisors without a verifiable live worker, conflicting modern identity, foreign execution contexts, or unavailable inspection receive guided recovery instead. Use the original CLI or service manager to stop the old runtime. Before removing abandoned `runtime.owner`, `runtime.stop`, `server.pid`, or `background-runtime.json`, independently verify that every runtime, supervisor, worker, and lifecycle command using that scope has stopped. Never delete these records merely because the recorded PID is absent locally. Stopping before upgrading remains the simplest upgrade procedure.
- **Persisted identity on other platforms:** macOS identity records use `ps` start time in UTC, with one-second precision. Legacy records without identity evidence require guided migration; this does not change normal restarts of runtimes with valid identity records. Windows identity records use PowerShell process start ticks. Missing tools, denied access, unsupported platforms, or mismatched execution contexts remain uncertain and fail closed. Linux file-lock recovery does not apply on these platforms.
- **Background containers:** An abandoned supervisor lock does not prove that its worker has exited. If a worker belongs to a different PID namespace and its death cannot be verified, background recovery remains blocked. Stop or verify the entire old container before manually recovering its metadata.
- **Coordination boundary:** This protects one scope on storage with reliable locking; it is not a distributed multi-host lifecycle service. Run stop/restart from the runtime's execution context. Identity checks precede ordinary numeric-PID signals, so a small check-to-signal race remains; macOS also has the start-time precision limit above. PID-file cleanup rechecks the recorded generation, but does not atomically compare-and-delete against a concurrent publisher.

### Start in the background

`1mcp serve --background` starts a persistent supervisor with one detached runtime worker and returns after the worker acknowledges activation of the intended generation and configuration, so scripts can continue:

```bash
1mcp serve --background
1mcp serve --background --config-dir ./config --port 3051
```

The command reports the activated version, supervisor and worker PIDs, ownership generation, configuration digest, URL, and backend loading summary, then exits `0`. Activation means the intended generation owns the scope, loaded the frozen configuration, and bound its endpoint. It does not mean every backend passes `/health/ready`.

```text
Runtime activated (version <installed-version>).
Background runtime started.
Supervisor PID: 48190
Runtime PID: 48213
Generation: <claim-id>
Configuration: <configuration-digest>
URL: http://localhost:3050/mcp
Backend health: <loading-summary>
```

Behavior:

- **HTTP only.** `--transport stdio` is rejected (stdio cannot be detached). `sse` is normalized to HTTP, and the runtime records `transport: http`.
- **Activation and loading.** Startup timing follows the configured loading mode. `--enable-async-loading` allows the HTTP endpoint to bind while upstream servers load. Backend loading failures remain separate from the activation acknowledgement.
- **Deterministic logs.** When no `--log-file` or `logging.file` is configured, background logs default to `<config-dir>/logs/server.log`.
- **Exclusive startup.** If the Runtime Scope is already owned, the command exits non-zero without spawning another runtime worker or binding a port. Simultaneous starts have exactly one winner. A separate `--config-dir` is a separate scope and can run independently.
- **Crash recovery.** Every unexpected worker exit consumes an attempt. The supervisor retries up to five times after 1, 2, 4, 8, and 16 seconds, reusing the original effective configuration, transport, host, port, logging, and startup options.
- **Stable reset.** The retry counter resets only after a replacement activates and stays alive for five minutes.
- **Health is observational.** A live worker that later fails readiness is reported as unreachable; it is not killed or restarted solely because of health.
- **Terminal failure.** After retry exhaustion, the supervisor stays resident in `crash-loop` without a worker. Use `--stop` before starting again if no worker is available to acknowledge a cooperative drain. Failed initial activation exits non-zero.
- **Orphan handling.** If the supervisor dies while its worker remains alive, new work is closed and ownership evidence remains. Use the original service manager or explicit verified recovery; a cooperative restart does not adopt or signal an orphan based on its recorded PID.
- **Stale ownership.** Cooperative startup requires an empty scope and never reclaims existing records. Resolve stale or ambiguous evidence through explicit recovery before starting.

### Check runtime status

`1mcp serve --status` discovers the runtime occupying the selected Runtime Scope and reports it:

```bash
1mcp serve --status
1mcp serve --status --config-dir ./config
```

A compatible background runtime is queried through its authenticated supervisor; readiness remains a separate HTTP probe. Legacy supervised reports include the supervisor and runtime PIDs, restart attempt, last exit, next retry, URL, start time, log file, and readiness:

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

Status does not restart or kill a process. Cooperative status does not clean lifecycle metadata. Legacy discovery may clean records only when it can independently establish that they are stale; unreachable or ambiguous ownership remains in place.

### Stop the runtime

`1mcp serve --stop` stops only the runtime in the selected Runtime Scope:

```bash
1mcp serve --stop
1mcp serve --stop --config-dir ./config
```

For a compatible background runtime, an authenticated request asks the supervisor to stop its worker and cancel pending retries. Ownership is released only after the tracked worker exits. This is a deliberate stop, not the reversible drain used by restart. An unreachable supervisor requires explicit recovery.

```text
Background runtime stopped.
```

Behavior:

- **Scope-isolated.** Only the runtime recorded for the selected Runtime Scope is signalled; a runtime in a different `--config-dir` is never touched.
- **No respawn.** A pending retry is cancelled before the worker is stopped, and ownership is released only after supervisor and worker termination.
- **Orphan recovery.** Cooperative control cannot stop an unreachable supervisor or adopt a surviving worker. Legacy recovery requires independent identity evidence; otherwise use the original service manager.
- **Clean when idle.** If nothing is running it reports so and exits `0`, removing stale metadata when it is safe to do so.

### Restart the runtime

`1mcp serve --restart` replaces a compatible background supervisor and worker with the installation that runs the command:

```bash
1mcp serve --restart
1mcp serve --restart --config-dir ./config --port 3051 --drain-timeout 60
```

Install the desired version through your package manager or binary deployment process first, then invoke that installation's `serve --restart`. The command does not download or install packages.

Behavior:

- **Preflight before interruption.** Authenticate the old supervisor, require compatible capabilities and explicit launch-input provenance, and strictly validate the current configuration with the invoking installation. Invalid configuration leaves the running generation untouched.
- **Frozen replacement configuration.** Explicit launch settings are preserved, including values equal to old defaults; explicitly supplied restart options override supported settings. Omitted values use the new installation's defaults. The replacement loads the validated snapshot, and hot reload resumes after activation.
- **Reversible drain.** Close admission to new backend work and configuration mutations while existing operations finish. New work receives a retryable draining error; interaction replies, progress, and cancellation remain available. Idle sessions do not block the drain.
- **Listener activation.** Cooperative background startup accepts clients before backend loading finishes, even with `--enable-async-loading=false`. The explicit setting and notification policy remain preserved; foreground startup is unchanged. Backend loading remains visible at `/health/mcp`.
- **Bounded preparation.** The default deadline is 30 seconds (`--drain-timeout`). Expiry before commit reopens admission and aborts replacement, even if all calls finished or the coordinating CLI disappeared. Repeating preparation does not extend the deadline.
- **Exclusive activation.** After commit, retire the old worker and supervisor before the replacement claims the scope. A competing owner or incomplete retirement blocks activation. A successful report confirms the new generation and configuration digest, with backend health reported separately.
- **Interruption is expected.** Sessions and connections may disconnect. Tool calls are never automatically replayed. If activation fails after the old runtime retires, the command reports failure and does not roll back automatically; fix the cause and retry.
- **Compatibility and recovery.** An incompatible or unresponsive runtime is not forcibly replaced through cooperative control. Preserve its records and use the original CLI, service manager, or independently verified legacy recovery. An empty scope starts normally; `--transport stdio` remains unsupported.

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

### Start with lazy loading

```bash
1mcp serve --enable-lazy-loading
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
