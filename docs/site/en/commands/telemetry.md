---
title: Telemetry Command - Product Usage Controls
description: Inspect, enable, disable or reset local aggregate Product Usage Telemetry.
head:
  - ['meta', { name: 'keywords', content: '1MCP,telemetry,privacy,usage,installation' }]
  - ['meta', { property: 'og:title', content: 'Telemetry Command - Product Usage Controls' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Inspect, enable, disable or reset local aggregate Product Usage Telemetry.',
      },
    ]
---

# Telemetry Command

Use `telemetry` to inspect or change this OS user's Product Usage Telemetry.

```bash
1mcp telemetry status
1mcp telemetry status --json
1mcp telemetry disable
1mcp telemetry enable
1mcp telemetry reset
```

## Scope and controls

Controls always apply locally, including when `--context` or `--url` selects a remote runtime. `--config-dir`, checkout and project selection do not change the installation store. Status and controls do not count as usage and do not create a UUID or queue. Help and version also create no product state.

- `status` reports the stored preference, effective process policy, identity presence, queue size and coordination state. It does not print the UUID. An absent store stays absent.
- `disable` stores an off preference and clears unsent data, retaining an existing UUID.
- `enable` stores an on preference. It does not create a UUID or override process, CI or test suppression.
- `reset` clears the local UUID and unsent data while preserving the preference. Only a later enabled admission creates a new UUID. It does not erase transmitted service records. A durable generation tombstone prevents old processes from restoring the old identity or queue.

Running local runtimes observe saved disable/reset changes within five seconds under normal filesystem operation, discard stale facts, and try to abort their own active delivery. Already transmitted requests cannot be recalled. Polling and send opportunities create no usage or identity. After reset or re-enable, later genuine activity can admit a new generation; an activity arriving while admission is pending can be lost. Remote runtimes continue to follow their owner's settings.

## Collection policy

Collection defaults on. Before first admission, a coordinated notice is written to stderr, including the off command and documentation link. Healthy concurrent starts share one notice and random UUID. A crash between printing and saving notice completion can repeat the notice.

`inspect` contributes a closed command family and success/failure outcome. `serve` and `proxy` contribute one startup outcome at readiness, failure or cancellation, with no second outcome at shutdown. A background launch or restart is owned by its invoking parent; supervised workers contribute the distinct `runtime_start` feature, including automatic replacements. Status and stop do not count in this slice; cancellation is failure in wire schema v1. Arguments, server/tool names, paths, payloads, credentials, raw errors, diagnostics, traces and runtime/session identifiers are excluded. Other command families and MCP operations are not instrumented by this slice. Telemetry never writes to MCP stdout.

| Setting                                                                                     | Effect                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--product-telemetry=false`, `--no-product-telemetry`, or `ONE_MCP_PRODUCT_TELEMETRY=false` | Suppress this process without changing another process's queued data                                            |
| `DO_NOT_TRACK=true`                                                                         | Suppress this process                                                                                           |
| `CI=true`                                                                                   | Collection off unless dedicated `--product-telemetry-ci=true` / `ONE_MCP_PRODUCT_TELEMETRY_CI=true` is supplied |
| Stored `disable`                                                                            | Always wins over process enablement and CI opt-in                                                               |
| Test-owned execution                                                                        | Always suppressed; no ordinary E2E opt-in                                                                       |

Boolean values accept `true`/`false`, `1`/`0`, and `yes`/`no`, case-insensitively. Unset or empty standard `CI`/`DO_NOT_TRACK` values mean false; invalid values are rejected. Use explicit values for the two telemetry options. CI submissions carry a separate CI dimension.

## Identity, storage and delivery

The private store is `~/.config/1mcp/product-telemetry` on macOS/Linux and `~/AppData/Roaming/1mcp/product-telemetry` on Windows. It is shared across local Runtime Scopes for this OS user. POSIX directories/files require owner-only permissions (0700/0600); Windows uses a protected current-user ACL and rejects reparse points. Unsupported or denied privacy verification suppresses collection. Status/controls report failures instead of claiming success.

Summaries include the random installation UUID, actual activity time at second precision, version, OS, architecture, Node major and CI classification. Counts aggregate within a UTC day and these dimensions. Unsent data expires after seven days; the serialized queue is bounded to 256 KiB, with expired/oldest entries discarded. Batches contain at most 100 summaries and 64 KiB, with at most 16 counters per summary and 1,000,000 per counter.

Sends are opportunistic, with a 1.5-second request deadline. A batch is durably removed before its one final send attempt. Errors, rejection, timeout, ambiguous responses and process termination never requeue attempted data. A crash between removal and transmission loses that batch. Commands, readiness and shutdown never wait for delivery; very short commands can lose their final measurement, including when admission is still pending. Long-running processes offer a send every five minutes. Background timers and transport handles do not keep the process alive.

The first-party service retains detail for 90 days and installation-linked activity for at most 365 days. UUID-free daily totals may remain indefinitely. Counts are approximate observations of installations, not people or devices.

## Busy or ambiguous coordination

A live owner is never stolen by age. A demonstrably dead main lock owner can be recovered under a separate acquisition guard. Missing/corrupt owner metadata, permission uncertainty or an abandoned guard fail closed. `status` reports `busy-or-ambiguous`; collection drops work rather than affecting commands.

For offline recovery: stop **all** local 1MCP producers for this OS user, inspect `guard/owner.json` and `lock/owner.json` where present, and independently confirm every recorded process is absent. Only then remove the inspected `guard` and `lock` directories. Keep `state.json`, including its epoch/generation and preference. Restart and check status. Never delete coordination based only on age or while another producer may be running. If state itself is corrupt or privacy checks fail, retain it for diagnosis and fix the specific problem; status/controls will continue to report failure.
