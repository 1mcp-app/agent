---
status: accepted
---

# Operational Telemetry Excludes Managed Backend Diagnostics

During [#488 triage](https://github.com/1mcp-app/agent/issues/488#issuecomment-5971016381) on 2026-10-04, the maintainer approved preserving the sanitized **Managed Backend Log** diagnostic contract established by ADR 0011 while isolating it from **Operational Telemetry**. Backend diagnostic payloads, source identifiers, and arbitrary metadata remain in their existing local terminal/file/Admin domain; they do not enter typed telemetry events or signal pipelines and do not receive automatic telemetry correlation fields.

Replacing those diagnostics with constant events would remove existing operator information. Treating backend diagnostic content as telemetry would bypass source-side event privacy. All 1MCP-owned instrumented runtime paths therefore use the strict **Typed Telemetry Event** contract, while backend diagnosis retains its existing sanitization, retention, source ownership, and delivery requirements through an isolated boundary. Sharing an output destination does not authorize crossing that boundary, and future exporters must preserve it.

Local template lifecycle events retain explicitly registered operational facts: bounded configured template names, opaque random instance IDs, counts, and pooling settings. Names are restricted to letters, numbers, dots, underscores, and hyphens; URLs, paths, assignments, and arbitrary text are rejected. Session/client identities, rendered configuration hashes, and composite instance keys remain fingerprinted. This local diagnostic exception does not authorize recording rendered configuration, credentials, or request/backend payloads, nor exporting configured names or instance IDs as telemetry attributes.

Sanitized HTTP investigation is also a separate local diagnostic domain (`source=http-diagnostic`), rather than a relaxation of typed telemetry. It retains bounded endpoint/lifecycle facts at info level and bounded sanitized bodies at debug level, including complete JSON SSE data frames. Credential-bearing keys and strings are redacted, query values and authentication/cookie headers are omitted, and oversized or incomplete bodies are marked as omitted. These records receive a local request correlation ID without automatic trace enrichment and must not enter exporters or typed event normalization.
