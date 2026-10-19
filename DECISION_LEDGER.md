# Decision Ledger

This ledger records project-local decisions that materially affect implementation or verification.

## 2026-10-04 — MCP Events gateway attachment

**Status:** accepted from merged implementation; verification repair only.

**Context:** `main` at `ce6a24d2d57155999bdc3ee6fcf29d0fd5ea4fb6` merged MCP Events routing through the configured `agent-offload` provider. The implementation adds `ConfiguredServerEventsProvider` under `src/gateway/adapters/` and attaches it from `src/transport/http/routes/modernHttpRoutes.ts`.

**Decision:** Treat `modernHttpRoutes.ts -> @src/gateway/adapters/configuredServerEventsProvider.js` as an explicit outbound gateway-adapter attachment permitted by the existing SDK/gateway boundary policy. Keep the policy test strict for all unlisted gateway attachments; do not weaken or bypass the boundary check.

**Reasoning:** The provider implements `OutboundEraAdapter` and lives in the explicit gateway adapter layer. The same route already has an explicitly allowed attachment to the modern inbound adapter. CI failure in run `37214792652` was therefore an allowlist omission introduced by the merged Events implementation, not a runtime or dependency failure.

**Verification required:** `pnpm ci:static` and the repository GitHub Actions suite must complete successfully on the repaired commit.
