---
status: accepted
---

# Upstream schema timeouts preserve healthy capabilities

An individual upstream tool's schema admission timeout must withhold that tool from listing and invocation while preserving healthy capabilities, with explicit incompleteness and recovery information. A timeout does not prove the schema invalid; this deliberately favors partial availability over aborting the entire capability catalog, without permitting unvalidated tool use or silently presenting an incomplete catalog as complete.

Recovery occurs on a fresh capability listing from the first page or through existing capability refresh entry points; an existing pagination walk retains its original snapshot. No new background retry loop is introduced. Partial results carry structured recovery information and must not overwrite the last complete configured-tool discovery record as though discovery were complete, even when every upstream tool is withheld.

This decision covers only individual upstream tool admission timeouts. Shared validator unavailability and runtime-owned tool admission failures still fail the operation. It does not authorize bypassing schema validation or removing resource limits; any timeout-budget adjustment requires measured evidence. The behavior is accepted during issue #564 triage and is not yet implemented.
