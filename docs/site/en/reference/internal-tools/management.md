---
title: Management Tools
description: Inspect and change backend state through enabled internal management tools.
---

# Management Tools

These MCP tools operate on backend state and configuration when enabled. See [Internal tools](/reference/internal-tools/) for access requirements. Inspect the exposed input schema before a call; MCP tool names and options are not CLI subcommands.

## mcp_enable and mcp_disable

Both require `name`. Enabling or disabling changes the configured target's state; it does not validate a dependency graph or certify that all backend prerequisites are satisfied. Read the result's status, warnings, and reload recommendation, then verify runtime state. Disabling an independently hosted remote backend does not shut down that remote service.

## mcp_list

List configured servers. Inputs include `status`, `transport`, `tags`, `format`, `detailed`, `includeCapabilities`, `includeHealth`, and `sortBy`. Use the returned state as an observation, not a guarantee that a later tool call will succeed.

## mcp_status

Omit `name` for all targets or supply one target name. `details` defaults to `false`; enable it for instance and supervision details. `health` defaults to `true`.

The result is a current snapshot. It does not provide historical status tracking or trend analysis.

## mcp_reload

Request configuration reload or a named backend restart. `configOnly` defaults to `true`; `timeout` is in milliseconds and defaults to `30000`. Review `status`, `error`, and any structured `outcome`, including ambiguous-instance or disabled-target results.

Reload is not a zero-downtime or automatic rollback guarantee. It can affect connected work. `mcp_reload` is an MCP tool; there is no corresponding `1mcp mcp reload` CLI subcommand. For the supported CLI restart workflow, see [mcp restart](/commands/mcp/restart).

## mcp_edit

Edit one target identified by `name`. Supported fields include launch arguments, environment, URL, headers, tags, timeouts, and supervision settings. `env` and `tags` replace their existing values rather than appending to them.

Use `preview: true` to review changes before applying them. `backup` controls backup creation; inspect the result for `backupPath`, warnings, and `reloadRecommended`. A successful edit does not establish backend readiness. This API does not provide a syntax-highlighting editor or batch-edit interface.

## Verify a change

Check the target's current state, preview the intended edit where supported, apply only the authorized change, then inspect the result and runtime state again. A failed or ambiguous response is not a reason to repeat a mutation without checking whether it already took effect.
