---
title: Discovery Tools
description: Registry lookup tools and the limits of their returned metadata.
---

# Discovery Tools

These tools are exposed when the corresponding internal tools are enabled. Start with the [internal tools overview](/reference/internal-tools/) for invocation and access requirements.

## mcp_search

Search registry metadata using `query`, `status` (default `active`), `type`, `transport`, `limit` (default `20`), and `cursor`. Results include installation hints and prerequisite indicators.

The input schema also accepts `tags`, `category`, `offset`, and `format`, but the current handler does not apply these fields. It does not provide popularity sorting or a local fuzzy-search guarantee. `total` is the number of returned entries, not the registry's total size. An `installable` hint means metadata contains a package or remote endpoint; it does not prove that installation, credentials, or startup will succeed.

## mcp_registry_status

Check connectivity through the configured registry adapter. `includeStats` defaults to `false`. The response can include response time and a last-check timestamp, not a historical uptime series. The `registry` input labels the result; it does not switch the adapter to an arbitrary URL.

## mcp_registry_info and mcp_registry_list

These handlers currently return static placeholder registry descriptions and counts. Do not treat their entries, online labels, or package counts as live discovery, verified endpoints, or availability evidence. Use [registry commands](/commands/registry/) for the supported registry workflow.

## mcp_info

Look up a registry entry by required `name` and optional `version`. This is not an inspection of a running backend. The current response uses placeholder runtime status, transport, and generated capability names; it must not be used as a callable tool inventory. The schema accepts `includeCapabilities`, `includeConfig`, and `format`, but the current handler does not condition the result on these fields.

Use [inspect](/commands/inspect) for actual visible capabilities and [mcp status](/commands/mcp/status) for runtime status.

## Suggested workflow

Search for an entry, review its prerequisites, and validate the proposed target with [mcp install](/commands/mcp/install). After setup, verify discovery against the intended running runtime. Registry metadata alone does not establish runtime readiness or trust in a backend.
