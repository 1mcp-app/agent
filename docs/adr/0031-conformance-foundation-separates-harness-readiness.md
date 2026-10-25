---
status: superseded by ADR-0032
---

# Conformance Foundation Separates Harness Readiness From Product Conformance

The MCP 2026 **Conformance Harness** is established before modern production adapters because requiring product conformance first would deadlock the implementation issues that depend on that harness. Its foundation issue may close when the harness, pinned peer fixtures, **Requirement Traceability Manifest**, and evidence validation work correctly, even though the resulting **Conformance Baseline** still reports deterministic failures for behavior not implemented yet. Those failures remain blocking and unwaived; later compatibility work must turn the same exact-source evidence green before the Stage 1 release verdict can pass.

## Consequences

**Sanitized Wire Evidence** uses synthetic loopback inputs only, applies source-side allowlisting and secret redaction, and excludes live credentials and user configuration. It retains enough protocol structure to schema-validate both gateway hops without treating a raw traffic dump as release evidence.

Superseded by [ongoing protocol regression coverage](0032-protocol-regressions-replace-migration-evidence.md).
