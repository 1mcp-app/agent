---
title: MCP operation telemetry
description: Counting boundaries and finite dimensions for aggregate MCP operation outcomes.
---

# MCP operation telemetry

This reference describes operation fields in Product Usage Telemetry. See [telemetry](/commands/telemetry) for collection controls.

## Counting boundary

The Aggregated Runtime records one outcome for an admitted MCP operation. Direct stdio, legacy HTTP/SSE, and modern HTTP requests are counted by their runtime owner. A stdio proxy forwards requests without creating a second operation fact. Private gateway bridges, REST adapters, upstream retries, notifications, cleanup, and duplicate terminal responses add no operation facts.

A completed response is `success`; protocol errors, tool results with `isError: true`, cancellation, and connection loss before completion are `failure`. Wire version 1 has no separate cancellation label. Response completion never waits for delivery. Disable and reset invalidate earlier collection admission; a late response cannot move its old fact into the new installation state.

`input_required` is a successful protocol response; its continuation is another admitted request. These outcomes do not establish that the user’s task finished.

Command, feature, and operation counters describe separate families. A `run` command can cause an MCP operation; adding these counters does not produce a count of unique user actions.

## Exported dimensions

| Field       | Values                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `kind`      | `operation`                                                                                                                        |
| `name`      | `tools_list`, `tools_call`, `resources_list`, `resources_read`, `prompts_list`, `prompts_get`, `completion`, `initialize`, `other` |
| `outcome`   | `success`, `failure`                                                                                                               |
| `transport` | `stdio`, `http`, `sse`                                                                                                             |
| `client`    | `claude`, `codex`, `cursor`, `vscode`, `other`                                                                                     |
| `bucket`    | `none`                                                                                                                             |
| `count`     | Aggregate occurrence count                                                                                                         |

Names map from the matching MCP method, such as `tools/list` to `tools_list`; `completion/complete` maps to `completion`. Other admitted methods use `other`. HTTP streaming responses retain `http`; the retained SSE transport uses `sse`.

Client recognition uses exact names: `claude`, `claude-ai`, and `claude-code` map to `claude`; `codex` and `codex-mcp-client` map to `codex`; `cursor` maps to `cursor`; `vscode` and `Visual Studio Code` map to `vscode`. Unknown names, absent information, accessors, and proxies map to `other`. Client titles and versions are excluded.

No arbitrary method, client, tool, backend, URI, argument, result content, error text, or diagnostic field enters these counters. Ordinary tests and CI E2E are always suppressed.

Transport is the runtime ingress. A stdio proxy connected to an HTTP runtime records `http`, without another local operation count; direct runtime stdio records `stdio`.
