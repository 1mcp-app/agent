---
status: accepted
---

# Product Telemetry Service Has a Separate Repository

On 2026-10-12, the maintainer chose the future public `1mcp-app/telemetry` repository for the **Product Telemetry Service**. That repository owns the ingest Worker, private **Product Usage Dashboard**, D1 migrations/rollups/retention, and versioned receiver contract; `1mcp-app/agent` owns local collection hooks, identity/preferences, aggregation/delivery, and user controls. This separates service operations and release dependencies from the distributed runtime while keeping the first-party collection design auditable.

## Consequences

Client and receiver changes must verify the same schema version and representative fixtures across repositories; a successful build in either repository alone does not prove compatible ingestion or correct dashboard data. Dashboard access is private through Cloudflare Access despite public source, and its protection is separate from the public ingest endpoint. The maintainer confirmed the briefs and selected local documentation only; repository creation, publication, and implementation are outside this delivery scope. Production account/domains, maintainer allowlist, and activation remain separate release decisions.
