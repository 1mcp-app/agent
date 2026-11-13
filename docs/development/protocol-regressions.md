# Protocol regression testing

From the repository root, install the independent peer fixtures, then run the suite:

```bash
pnpm install --frozen-lockfile
pnpm --dir test/conformance/fixtures/typescript install --frozen-lockfile
uv sync --frozen --project test/conformance/fixtures/python
pnpm test:protocol
```

Use the repository Node/pnpm versions and Python 3.13 with uv. The command builds once, checks both peer fixtures, and runs protocol tests without retries. Tests own temporary configurations and subprocesses; they do not require a clean worktree or generate a release baseline. The historical `test/conformance` directory name remains to avoid unrelated file moves.

## Choose and interpret checks

`pnpm check` covers static, source/Admin unit, release, and permission checks. Run the protocol suite separately for protocol or SDK dependency changes. Its entry point is [the protocol runner](../../scripts/run-protocol.mjs); [CI workflows](../../.github/workflows) define hosted gates.

The suite covers gateway transports, modern/legacy peers, independent TypeScript/Python fixtures, negotiation, authenticated continuations, request isolation, and notifications. Consult the tests for individual assertions rather than using a copied coverage inventory.

- If peer setup fails, check the repository toolchain versions and both frozen fixture installations before investigating protocol behavior.
- If a protocol assertion fails, identify the transport and peer combination, then inspect its request/response behavior. A retry is not a substitute for diagnosing the failure.
- If a test hangs, inspect owned subprocess teardown and fixture readiness using the [E2E harness guidance](../../test/e2e/README.md).
- If an SDK boundary or patched-source check fails, inspect the [import policy](../../scripts/sdk-boundary/import-policy.mjs) and [retained transport checks](../../scripts/vendor-legacy-transport.mjs) before changing imports or regenerated assets.

A local pass verifies the exercised protocol journeys. Release publication and deployment require their own checks; record run results in the PR or CI run.

## Dependency and release policy

Manifests and frozen lockfiles determine current peer versions. The build verifies the legacy SDK patch, retained source hashes, imports, and license provenance; use these owning files when updating dependency compatibility. Missing exports, inconsistent installations, and changed patched sources still fail.

New `release-gates.json` records use `schemaVersion: 1`, `sha`, `ci`, and `checks`. Required checks must all succeed for the selected candidate. Recovery rejects unknown schemas, wrong source revisions, missing checks, and failed/cancelled/skipped results. Unversioned historical records keep their original conformance policy. Neither format proves publication or deployment.
