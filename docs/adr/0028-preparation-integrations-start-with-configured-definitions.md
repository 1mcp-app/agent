---
status: accepted
---

# Preparation Integrations Start With Configured Definitions

Use local **Integration Definitions** and guided configuration for CodeGraph, Code Review Graph, and Serena, while treating server setup and automatic **Backend Preparation** as independent capabilities. Offer automatic preparation only where supported public interfaces provide verified readiness, freshness, writer ownership, and cancellation semantics. This keeps setup simple without coupling 1MCP to private backend implementations or making unsupported automation a prerequisite for useful servers.

## Considered Options

The original 2026-10-14 decision required automatic preparation for all three catalog entries. The maintainer revised it on 2026-10-15 to allow setup-only examples with demonstrated native operations; this gives up guaranteed automatic preparation for every example while retaining every safety gate for advertised automation. [Issue #651](https://github.com/1mcp-app/agent/issues/651) carries the revised implementation brief; acceptance of this decision does not establish implementation or native acceptance.

Code-based plugins were deferred in favor of local definitions and inline configured commands using the existing scheduler. Maintained shipped helpers are permitted only through that command contract, amending ADR 0023’s original bundled-behavior exclusion without introducing a plugin loader or another execution system.

## Consequences

Server setup and automatic preparation are independent. CodeGraph, Code Review Graph, and Serena are maintained examples of a generic declarative setup path, not runtime special cases. Setup reuses validation, backup, reload, checkout binding, and explicit authority; it preserves overrides and unrelated configuration without requiring hand-authored integration glue.

Advertise automatic preparation only when supported public interfaces verify operation-specific readiness, freshness, writer ownership, and owned-process cancellation. Otherwise provide usable setup and explicit native next steps. Connectivity, successful exit, and configuration fixtures do not prove preparation support.

Local definitions and small shipped command helpers reuse the scheduler; native forks, private API patches, duplicated indexing logic, remote definition downloads, and a plugin loader are excluded. Explicit setup may enable permitted preparation for fresh authorized worktrees; upgrades alone cannot activate it. Dependency installation, rebuilds, and paid actions retain separate authority. Definition/helper revisions invalidate readiness until compatibility is rechecked.

## Considered Options

Requiring automatic preparation for every example was relaxed to permit setup-only support with demonstrated native operations. This gives up universal automation while retaining every safety gate for advertised preparation. These changes amend [ADR 0023](0023-backend-preparation-separates-orchestration-from-native-semantics.md), not its orchestration boundary.
