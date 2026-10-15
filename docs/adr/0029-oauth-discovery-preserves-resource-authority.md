---
status: accepted
---

# OAuth Discovery Preserves Resource Authority

For the interoperability fixes agreed in [issue 653](https://github.com/1mcp-app/agent/issues/653#issuecomment-6193351974), metadata is validated according to its discovery role. Authorization-server metadata may contain resource-related extension fields without becoming protected-resource metadata. Discovery requests may retain query parameters, while existing resource-query matching and destination checks continue to constrain **Upstream OAuth Authority**. Fetching a metadata document does not authorize broader credential use; provider-specific exceptions and automatic query stripping were rejected.

OAuth failures expose a bounded stage, reason, and recovery guidance in local diagnostics and the authenticated Admin Console while preserving existing HTTP status contracts. Consistent with [ADR 0022](/adr/0022-operational-telemetry-excludes-managed-backend-diagnostics), query values, credentials, headers, and raw provider responses are excluded, and diagnostic failures cannot change authorization outcomes or enter telemetry exporters.

Deterministic integration tests must cover discovery through authorization-URL creation, negative authority cases, and diagnostic redaction. Live-provider checks provide supplementary evidence; authorization-URL creation does not establish completed provider consent.
