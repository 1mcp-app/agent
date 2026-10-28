---
status: accepted
---

# First-party Product Usage Telemetry

On 2026-10-12, the maintainer chose a separate **Product Usage Telemetry** contract for active installations and retention, version/platform adoption, and 1MCP-owned command, feature, and transport use with coarse success/failure counts. Collection defaults on with notice and opt-out, sending accepted data to a public-source, first-party Cloudflare Worker and 1MCP-owned D1 storage without forwarding to an analytics vendor. Explicit opt-in and managed analytics were considered; the selected approach keeps collection and storage auditable and owned by 1MCP while making notice and a dependable off-switch part of the product contract.

## Consequences

Collection admits only closed product labels, coarse environment facts, bucketed counts, and outcomes; it excludes customer payloads, credentials, paths, arbitrary backend names, and local diagnostics. Clients and runtimes divide counting responsibility to avoid counting proxy forwarding twice. Local aggregation and bounded best-effort delivery cannot delay requests or change outcomes.

A random installation UUID is pseudonymous, shared across local Runtime Scopes, and retained across disable/re-enable. A notice precedes collection. Any explicit disable wins, stops collection/network activity, and creates no identity or queue; stored disable clears unsent data. Reset removes local identity and unsent data, not transmitted records. Running runtimes observe preference changes; remote runtimes follow their owner's preference. CI is off by default and tests are always excluded.

Detailed records last 90 days; installation-linked history and inactive identities last at most 12 months. UUID-free daily totals may persist indefinitely. The private aggregate-only dashboard and public ingest have separate access boundaries in the service repository defined by [ADR 0025](0025-product-telemetry-service-has-a-separate-repository.md). Acceptance of this design does not authorize collection or deployment.
