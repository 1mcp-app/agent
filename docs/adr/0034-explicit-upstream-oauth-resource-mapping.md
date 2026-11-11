---
status: proposed
---

# Explicit Upstream OAuth Resource Mapping

For [issue 737](https://github.com/1mcp-app/agent/issues/737), support an explicit per-upstream mapping between the transport URL and the OAuth resource identifier, so option query parameters can remain on MCP requests when the provider advertises a queryless resource. Preserve strict query matching by default as established in [ADR 0029](0029-oauth-discovery-preserves-resource-authority.md): query parameters can identify security boundaries, so neither automatic query stripping nor a blanket ignore-query switch expresses sufficient operator intent.

## Decision status

The maintainer agreed to generic, explicit compatibility and unchanged strict defaults. The permitted mapping, metadata validation contract, configuration surface, and credential lifecycle remain under discussion; this proposal does not authorize implementation yet.
