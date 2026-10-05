---
title: Logging and trace context
description: Configure local 1MCP logs, understand their privacy limits, and follow MCP trace context across servers.
---

# Logging and trace context

1MCP writes local logs for startup, connections, configuration changes, and request failures. It also forwards valid trace context supplied by MCP clients, so related operations can be correlated across servers that support tracing. No tracing setup is required for normal use.

## Choose where logs go

The default log level is `info`. Use `debug` when investigating a problem and `--log-file` to keep a local copy:

```sh
1mcp serve --log-level debug --log-file ./1mcp.log
```

The same settings are available as `ONE_MCP_LOG_LEVEL` and `ONE_MCP_LOG_FILE`. Supported levels are `debug`, `info`, `warn`, and `error`.

HTTP mode writes to the console and, when configured, the log file. Stdio mode suppresses runtime console logs to keep the MCP channel clear; configure a file to inspect those logs. Background mode defaults to `<config-dir>/logs/server.log` when no log file is configured. See [serve](/commands/serve) for background operation and [configuration](/guide/essentials/configuration#logging-configuration) for logging options.

## Read runtime logs

Typed runtime log entries include a timestamp, level, a fixed message, and an event identifier. Additional fields describe the outcome, counts, or a bounded error category. Their debug entries omit request payloads and exception stacks; sanitized local HTTP diagnostics are described separately below.

Some entries use fingerprints instead of server, session, client, or request identifiers. You can compare matching fingerprints of the same kind within one process's logs; they change after a restart and cannot be used as configuration names or request IDs.

Template lifecycle entries include `templateName`, the opaque random `instanceId`, template/client counts, and pooling settings where applicable. Configured names containing only letters, numbers, dots, underscores, or hyphens are shown, up to 256 UTF-8 bytes; other names are omitted. Processing and key-resolution events also include a `templateId_fingerprint` for correlation regardless of name syntax. Rendered configuration hashes and composite instance keys remain fingerprinted because they can depend on credentials or session identity. No rendered configuration is logged.

When an operation has valid incoming trace context, its runtime entries can include `trace_id`, `span_id`, and `trace_flags`. Entries without an active trace context omit those fields. Background lifecycle entries and other work outside a traced operation may therefore have no trace ID.

## Inspect local HTTP diagnostics

Local HTTP diagnostics use `source=http-diagnostic`. At `info`, `http.request`, `http.response-start`, and `http.response` share a generated `requestId` and report the endpoint, HTTP method, status, content type, response byte count, elapsed milliseconds, and disconnect outcome where available. Response-start entries are written when headers are sent, so open SSE connections remain visible. Query values and authentication/cookie headers are omitted.

After body parsing, `http.request-context` records a recognized MCP method at `info`. At `debug`, `http.request-body` and `http.response-body` include sanitized application bodies. Request bodies are logged before authentication or backend dispatch, so pending operations can be investigated; completed JSON SSE data frames are parsed and sanitized too. Credential keys, OAuth codes/state/PKCE, session IDs, signatures/proofs, cookies, and recognizable credential strings are redacted. These local diagnostic records are separate from typed telemetry and do not receive automatic trace fields.

Each serialized sanitized body is capped at 8 KiB, with a maximum snapshot depth of six and 256 nodes. Oversized, binary, compressed, invalid JSON, or incomplete response bodies use explicit omission markers. Long-running streams report their start immediately and their summary/body when they finish or disconnect. Application content can remain in debug diagnostics, so review it before sharing a log file.

## Follow trace context

A tracing-aware MCP client can supply W3C context in request metadata:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "_meta": {
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    }
  }
}
```

1MCP forwards valid `traceparent` and optional `tracestate` metadata to the selected backend. Related server-to-client requests and continuation requests retain the operation's context. Invalid context is ignored; it does not change authorization or server selection. HTTP trace headers do not substitute for MCP request metadata.

This support carries existing context; 1MCP does not generate spans, collect metrics, or export telemetry to a collector. Setting an OTLP endpoint does not enable export, and `OTEL_SDK_DISABLED=true` does not turn off message context propagation. A backend's own tracing and export settings remain under that backend's control.

## Privacy and backend diagnostics

1MCP runtime events omit raw tool arguments, response payloads, headers, URLs, paths, error messages, and stacks. Request and result `_meta.baggage` is removed rather than forwarded. Application data with a field named `baggage`, such as a tool argument or `structuredContent.baggage`, remains unchanged.

Managed backend stderr is available separately in the Admin Console's [Backend Logs](/guide/advanced/backend-logs) workspace. Those entries contain sanitized backend diagnostics and have their own retention limits. They do not receive 1MCP trace correlation fields. Review backend diagnostic content before sharing a log file that contains it.

## Troubleshooting

- **No runtime logs with stdio:** set `--log-file`; runtime console logging is suppressed in this mode.
- **No trace IDs in logs:** check that the MCP client sends valid `params._meta.traceparent`. An HTTP header alone is insufficient.
- **No traces in your collector:** context propagation does not enable telemetry export. Check the tracing configuration of the client or backend that creates spans.
- **An error lacks upstream details:** inspect the managed server's Backend Logs in the Admin Console, or the remote backend's own logs. Runtime events report bounded error facts.
