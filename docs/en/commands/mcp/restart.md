---
title: MCP Restart Command - Restart Runtime Backends
description: Restart static backends or active template instances in a running 1MCP aggregated runtime.
head:
  - ['meta', { name: 'keywords', content: 'mcp restart,runtime backend,stdio supervision,template instance' }]
  - ['meta', { property: 'og:title', content: '1MCP Restart Command Reference' }]
  - ['meta', { property: 'og:description', content: 'Restart supervised MCP backends in a running 1MCP runtime.' }]
---

# mcp restart

Restarts a backend owned by a running 1MCP aggregated runtime.

## Synopsis

```bash
npx -y @1mcp/agent mcp restart <name> [options]
```

## Arguments

- **`<name>`** - Name of a static server or template backend. Required.

## Backend Selectors

- With no backend selector, a static server is restarted. For a template, the command restarts all unhealthy active instances. `backend_no_active_instances` means the template has no live instances; `backend_no_unhealthy_instances` means every active instance is currently healthy, so the default policy performs no restart.
- **`--instance <id-or-prefix>`** - Restart one active template instance by its full 64-character instance ID or an unambiguous prefix. Status output uses the first 12 characters as the short display ID. An ambiguous prefix is rejected and reports the matching candidates.
- **`--all-instances`** - Restart all active instances of the named template.

`--instance` and `--all-instances` are mutually exclusive.

## Runtime Target Options

- **`--context <name>`** - Select a configured Runtime Target Context. When omitted, the current context is used.
- **`--idempotency-key <key>`** - Reuse a stable key when retrying the same operation.
- **`--wait-ms <milliseconds>`** - Maximum time to wait for completion. Defaults to `5000`.
- **`--confirm-non-loopback`** - Confirm a mutation against a non-loopback runtime target.
- **`--json`** - Emit a machine-readable result.

This is a runtime-backed operation, not a configuration edit. The selected runtime must advertise the `mcp.restart` admin capability, and the Runtime Target Context must have an authenticated Admin Session. An ephemeral `--url` cannot be used for this credentialed mutation; first add or select a Runtime Target Context.

Manual restart clears the backend's automatic-restart attempt counter and starts recovery immediately. It uses the same full fresh-connection lifecycle as automatic supervision: the current backend becomes unavailable, its capabilities and instructions are withdrawn, and a new process, transport, and MCP client connection complete initialization before availability is restored.

## Examples

```bash
# Restart a static backend in the current Runtime Target Context
npx -y @1mcp/agent mcp restart filesystem

# Restart one template instance by an unambiguous ID prefix
npx -y @1mcp/agent mcp restart github --instance 6f44b6a1c2d3

# Restart every active instance of a template
npx -y @1mcp/agent mcp restart github --all-instances

# Select another Runtime Target Context and request JSON output
npx -y @1mcp/agent mcp restart filesystem --context staging --json
```

## See Also

- **[MCP server configuration reference](/reference/mcp-servers)** - Configure automatic stdio supervision
- **[mcp status](/commands/mcp/status)** - Inspect backend runtime status and supervision facts
