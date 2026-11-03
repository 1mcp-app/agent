---
status: accepted
---

# Protocol Regressions Replace Migration Evidence

Supersedes [ADR 0031](0031-conformance-foundation-separates-harness-readiness.md). The MCP-2026 migration evidence framework has completed its role as implementation scaffolding. Ongoing validation uses blocking protocol regressions and candidate-bound release check records instead of frozen dependency snapshots, baseline verdicts, requirement inventories, and wire-proof release artifacts. This permits routine dependency updates without asserting complete specification conformance or dropping legacy compatibility.

The patched legacy SDK keeps its exact patch and retained-source protections. Peer versions follow their manifests and frozen lockfiles. Recovery of historical releases continues to require the conformance verdicts recorded under their original policy; new versioned records require the protocol regression job and every other applicable release check.
