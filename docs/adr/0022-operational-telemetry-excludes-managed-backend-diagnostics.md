---
status: accepted
---

# Operational Telemetry Excludes Managed Backend Diagnostics

During [#488 triage](https://github.com/1mcp-app/agent/issues/488#issuecomment-5971016381) on 2026-10-04, the maintainer approved preserving the sanitized **Managed Backend Log** diagnostic contract established by ADR 0011 while isolating it from **Operational Telemetry**. Backend diagnostic payloads, source identifiers, and arbitrary metadata remain in their existing local terminal/file/Admin domain; they do not enter typed telemetry events or signal pipelines and do not receive automatic telemetry correlation fields.

Replacing those diagnostics with constant events would remove existing operator information. Treating backend diagnostic content as telemetry would bypass source-side event privacy. All 1MCP-owned instrumented runtime paths therefore use the strict **Typed Telemetry Event** contract, while backend diagnosis retains its existing sanitization, retention, source ownership, and delivery requirements through an isolated boundary. Sharing an output destination does not authorize crossing that boundary, and future exporters must preserve it.
