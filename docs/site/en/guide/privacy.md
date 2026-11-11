---
title: Privacy and Product Usage Telemetry
description: What 1MCP sends, why it sends it, and how to control or disable Product Usage Telemetry.
---

# Privacy and Product Usage Telemetry

1MCP uses Product Usage Telemetry to understand installation activity, version and platform adoption, and which of its commands and features need improvement. **Collection is on by default outside CI and tests.** Before initial collection, 1MCP prints a notice to stderr with the disable command. It never puts this notice on MCP stdout.

## Turn collection off

To disable collection for your local OS-user installation, including its running runtimes:

```bash
1mcp telemetry disable
1mcp telemetry status
```

The saved preference applies across your local projects and Runtime Scopes. Disable clears unsent summaries and keeps the existing installation ID. Running runtimes observe the change within five seconds under normal filesystem operation. Requests already transmitted cannot be recalled.

To suppress one execution, use `--product-telemetry=false` or set `ONE_MCP_PRODUCT_TELEMETRY=false`. `DO_NOT_TRACK=1` also suppresses collection. A saved disable or any process off-switch takes precedence over enablement. CI collection is off unless explicitly opted in; test-owned executions are always suppressed. Help, version, and `telemetry` controls do not collect usage or create an installation ID.

These controls are local even when you select a remote runtime. A remote runtime follows its owner's preference; ask its operator about collection there. Turning off Product Usage Telemetry does not change runtime diagnostic logging or Operational Telemetry settings.

## What is sent

The client sends bounded, locally aggregated summaries to the first-party endpoint `https://ingest.1mcp.app/v1/summaries` over HTTPS. The fields are fixed in the versioned client code; the service cannot download a broader collection policy into the client.

| Data                      | Included information                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Installation and delivery | A random installation UUID and a random batch UUID                                                        |
| Activity time             | Activity timestamp at second precision; counts aggregate within a UTC day                                 |
| Product and platform      | 1MCP version, OS family, architecture, Node.js major version, and CI classification                       |
| Usage counts              | Fixed command, feature, and MCP-operation categories with coarse success/failure outcomes                 |
| Connection categories     | Runtime ingress transport and a fixed client-family label: Claude, Codex, Cursor, VS Code, other, or none |
| Configuration sizes       | Server/tool count buckets: 0, 1, 2–5, 6–20, 21–100, or 101+                                               |

Summaries **exclude prompts, tool arguments and results, resource contents, credentials, paths, URLs, IP addresses, headers, raw errors, environment snapshots, and arbitrary backend, tool, client, preset or tag names**. They also exclude runtime, Runtime Scope and session identities, diagnostic fingerprints, and trace correlation. An unknown client is recorded as `other`; its supplied name and version are not sent.

The random installation ID is **pseudonymous, not anonymous**: it lets the service associate summaries from the same local installation over time. It is not an account ID or hardware fingerprint. As with any HTTPS connection, the receiving network infrastructure can observe connection metadata such as the source IP; excluding IP addresses from the summary does not make the connection anonymous.

## Local storage and reset

One private store is shared by this OS user's local Runtime Scopes: `~/.config/1mcp/product-telemetry` on macOS/Linux, or `~/AppData/Roaming/1mcp/product-telemetry` on Windows. It holds the preference, notice state, random ID, and unsent summaries. The client requires owner-only file permissions on POSIX or a protected current-user ACL on Windows. If it cannot verify these protections, collection is suppressed.

The unsent queue is limited to 256 KiB. Summaries expire after seven days; expired or oldest entries are discarded to stay within the limit. Delivery is best effort and never delays MCP requests, command completion, readiness, or shutdown. Offline periods, short-lived commands, and failed send attempts can lose measurements.

```bash
1mcp telemetry reset   # Clear the local ID and unsent summaries; keep the saved preference
1mcp telemetry enable # Allow later activity to collect, unless another off-switch applies
```

Reset creates no replacement ID itself. A later enabled collection creates one. Disable/re-enable preserves an existing ID. **Reset does not delete records already received by the service.** To remain off after reset, keep the saved preference disabled.

## Service retention and access

The service policy specifies:

- Detailed summaries expire after 90 days.
- Installation-linked cohort history is kept for at most 12 months.
- Inactive service identities expire after 12 months.
- Daily totals without installation UUIDs may be retained indefinitely.

These windows do not expire the local ID; it remains until an explicit reset. Reports describe approximate installation activity, not a count of people. Enabled CI activity is reported separately from headline installation and retention metrics.

The service design uses 1MCP-owned Cloudflare Worker/D1 infrastructure without forwarding summaries to an analytics vendor. Its aggregate dashboard is private to maintainers and has no installation drill-down. Collector publication, access protection, and retention operation are service release requirements; this client documentation does not establish the live deployment's compliance. The client implementation is available in [the 1MCP repository](https://github.com/1mcp-app/agent/tree/main/src/productTelemetry).

For exact option precedence and troubleshooting, see [telemetry commands](/commands/telemetry). For category definitions, see [command and Admin adoption](/reference/product-telemetry-adoption), [MCP operations](/reference/product-telemetry-operations), and [configuration buckets](/reference/product-telemetry-configuration).
