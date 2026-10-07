# Maintainer release runbook

This runbook is for maintainers publishing 1MCP. Use the manual **Release Pipeline** entry point. An authorized maintainer's manual dispatch authorizes publication. The workflow records the initiating and triggering actors and run URL automatically. Compatibility, performance, canary and rollback acceptance for the MCP 2026 program remains tracked in [#485](https://github.com/1mcp-app/agent/issues/485); those decisions are release checklist work, not URL inputs on every dispatch.

## Before dispatch

- Use the current approved Release Pipeline revision. `target_ref` must be `main` or the matching `release-MAJOR.MINOR` branch. Use a new, unpublished version.
- Before a new release, ensure the source branch’s `.github/actions/setup-node-pnpm/action.yml` is byte-identical to the dispatch revision’s action. Version update and candidate resolution reject older or divergent local actions before invoking candidate code, because older actions may ignore cache opt-outs. Align the branch policy before preparing a new candidate; do not modify, rebuild or replace an existing recovery candidate to make this check pass. An incompatible historical candidate stops for owner reconciliation.
- Dispatch only when you intend to authorize publication of this candidate. Supply `version` for a new release; `target_ref` defaults to `main`. No approval or readiness URL is required. Existing environment protection rules still apply; the workflow does not add a reviewer requirement.
- Verify the existing `release` environment, repository permissions and npm trusted publisher are appropriate. The workflow preserves that environment; it does not install required reviewers or change its protection rules.
- npm trusted publishing must authorize this workflow and **Allow npm dist-tag** for alias promotion. The workflow installs npm `11.21.0`, which supports OIDC dist-tag actions. Publish permission alone is insufficient. Credential or trusted-publisher changes are separate owner work; do not fall back to adding a broad token after a failure.
- Complete applicable external security/readiness decisions before dispatch. A green workflow does not replace them. For the MCP 2026 program, use the #485 acceptance checklist.

## Normal release

An authorized maintainer can dispatch the release with: They dispatch jobs that write the version commit, registries, release tag, release assets and channel aliases.

```bash
gh workflow run release-pipeline.yml --repo 1mcp-app/agent --ref main   -f version=1.2.3

gh run list --repo 1mcp-app/agent --workflow release-pipeline.yml --limit 5
gh run watch RUN_ID --repo 1mcp-app/agent --exit-status
gh run download RUN_ID --repo 1mcp-app/agent --name release-summary --dir release-evidence
```

Replace the sample version and run ID with your selected values. `version` is optional in the dispatch form to permit recovery, but validation requires it for every new release. Versioning resolves one final commit. Reusable CI checks that SHA, including static/unit/Admin, all existing E2E shards, browser/system/packaging/upgrade/Windows installer, cooperative Node/SEA lifecycle and gate-mode product conformance. Native credential security checks also run on it. Product-red or missing, malformed or stale conformance evidence blocks publication, even when baseline infrastructure evidence is green.

Candidate packaging runs concurrently with CI and native-security checks; versioned publication and alias promotion still wait for all required gates and artifact smoke checks. The workflow builds with frozen dependencies and retains the installed/smoked npm tarball, five smoked SEA archives and four smoked OCI platform digests. Per-artifact JSON records bind the version/channel/SHA to SHA-256 archive checksums, npm SHA-512 integrity and OCI digests. Independent builds from the same SHA need not have identical bytes; promotion uses the retained tested objects without rebuilding.

Versioned npm publication initially uses `candidate-VERSION` (dots replaced by hyphens), which is a staging dist-tag. OCI basic/extended version manifests refer to the tested amd64/arm64 digests; GitHub release assets use the retained SEA archives. After a successful npm command, missing version readback is polled for at most ten minutes to allow registry propagation; the publish command is never retried. Conflicting metadata or registry errors stop immediately. npm identity/integrity, OCI revision/version/platform digests, the actual Git tag commit and downloaded binary checksums must all read back correctly before aliases can move. Stable promotion updates npm `latest`, OCI `latest`/`lite`, major/minor aliases for both variants and GitHub latest. The maintenance branch is finalized only after publication and promotion succeed.

Inspect `release-summary.json`, not just the green job indicator. It links the run/release and artifact-producing run; records manual dispatch authorization, actors, source branch and artifact identities, gate outcomes, verified publications and individual alias outcomes. `attempting` means the external outcome is uncertain. Summary collection and artifact upload run after failed jobs as well, subject to runner availability. Always-run collection has read-only permissions. A separate job in the existing `release` environment attaches a JSON snapshot; the summary links its intended asset and instructs the owner to inspect that protected job’s outcome. Attachment failure leaves the workflow artifact available. Each attached summary uses a run/attempt-specific filename and is never overwritten.

## Non-default-channel rehearsal

A real rehearsal is an authorized publication, not a local simulation. Dispatch a new prerelease version to authorize that rehearsal:

```bash
gh workflow run release-pipeline.yml --repo 1mcp-app/agent --ref main   -f version=1.2.3-beta.1
```

Beta/alpha/rc npm candidates promote to `next`, extended OCI to their prerelease channel (for example `beta`), and GitHub marks the release prerelease. They do not move npm `latest`, OCI stable/major/minor aliases, `lite`, or GitHub latest. Other named prerelease channels use their existing npm channel policy. Reserved stable alias names (`latest`, `lite`, `vMAJOR`, `vMAJOR-lite`) are rejected as prerelease channels.

## Recover a partial release

Never blindly rerun a failed publishing job. First download its summary and inspect logs/readbacks. Preserve the original version and exact source/artifact identity; do not retag, repack, rebuild or replace existing content under that version. Missing/expired artifacts stop recovery: choosing another run or rebuilding is not proof of the original tested bytes.

Read-only owner checks:

```bash
npm view @1mcp/agent@1.2.3 version gitHead dist.integrity --json
npm view @1mcp/agent dist-tags --json
gh api repos/1mcp-app/agent/git/ref/tags/v1.2.3
gh release view v1.2.3 --repo 1mcp-app/agent --json url,assets,isDraft,isPrerelease
docker buildx imagetools inspect ghcr.io/1mcp-app/agent:v1.2.3 --raw
docker buildx imagetools inspect ghcr.io/1mcp-app/agent:v1.2.3-lite --raw
```

For an annotated Git tag also query its tag object and resolve the commit. Compare downloaded GitHub assets with manifest checksums, and compare both OCI platform digests/revision/version with the original records. A registry error, unavailable readback, unexpected tag/release or conflicting asset is ambiguity, not absence. Stop for owner reconciliation; do not delete, overwrite, use `--clobber` on release binaries or replay a publish with an uncertain outcome.

After reconciliation, authorize recovery by dispatching with the **original artifact-producing Release Pipeline run ID** only. Leave `version` empty; `target_ref` is ignored during recovery:

```bash
gh workflow run release-pipeline.yml --repo 1mcp-app/agent --ref main   -f recovery_run_id=ORIGINAL_RUN_ID
```

Recovery runs its resolver from the dispatch revision before executing candidate code. It validates that the original completed run belongs to this repository/manual workflow and was dispatched from `main` or the matching maintenance branch. Its retained summary must match the selected run ID, artifact-producing run ID, latest run attempt and canonical run URL. Recovery derives the exact SHA, version, channel and source branch from that summary, validates their policy, and reruns source binding before any candidate code executes. Missing or expired summaries, mismatched identities, and summaries without a recorded source branch stop for maintainer reconciliation. Historical summaries from before this form simplification lack the source branch; do not guess it, edit their evidence or rebuild their candidate. Select an original artifact-producing run, never a recovery run. It parses candidate package metadata and local setup action as data, requires the setup action bytes to match the trusted dispatch revision, and requires the selected commit to belong to the approved release source branch before downstream checkouts. Its original CI and native-security gates must have passed. It reuses the original successful exact-SHA CI and native-security results, requires retained gate evidence with green infrastructure/product verdicts and every expected check successful, skips version rewriting and artifact rebuilding, and requires all original retained artifacts. Missing or conflicting gate evidence blocks recovery. Preflight verifies all existing versioned identities before writing any missing step. Matching npm/OCI content and binary assets are reused; explicitly absent versioned publications or binary assets are resumed. Existing Git tag without the matching release is ambiguous and requires owner action. Promotion re-queries all versioned identities and skips already matching aliases. npm channel verification reads fresh registry metadata instead of CLI-cached metadata and polls the previous tag value for at most ten minutes after a successful tag update, without repeating the write. A different unexpected tag value or a registry error stops promotion. No missing-publication decision is inferred from DNS, proxy or authorization errors.

The local fixtures simulate four failure classes without publishing: before publication, partial versioned publication, partial alias promotion, and existing identity conflict/ambiguity. They also cover beta/stable separation, original-run validation and missing/tampered artifacts. Run `node --test test/release/*.test.cjs` and `pnpm test:unit src/release`. Local results do not prove live registry, OIDC, protection or owner rehearsal behavior. A real owner rehearsal remains required before declaring release readiness; a red product conformance baseline must first be resolved by its owning workstream.

Configured release checks, version updates, artifact builds and publication neither restore nor save shared dependency caches. Selected-source pnpm and conformance uv caching is disabled; setup-node automatic package-manager caching is explicitly off. OCI release builds do not use shared GitHub Actions build caches. Ordinary CI without a selected checkout keeps its existing dependency caching. The trusted resolver binds candidate source to an approved branch before execution; cache isolation additionally avoids trusting or saving shared dependency caches during the release.

## Required security inventory

| Check                          | Execution and evidence                                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen dependencies            | Existing setup action uses `pnpm install --frozen-lockfile`; Docker stages use frozen lockfiles; conformance peers use frozen pnpm/uv locks.                                                                                                        |
| Workflow shell/input checks    | Existing reusable CI runs SHA-256-pinned actionlint with shellcheck; candidate/dispatch/recovery validation runs before credentialed publications.                                                                                                  |
| SDK supply-chain boundary      | Existing CI static job runs SDK boundary/topology checks and policy tests; conformance verifies pinned packages, requirements and exact-source evidence integrity.                                                                                  |
| AUTH-07 credential permissions | Existing CI runs `pnpm test:security-permissions`, including permission invariants and the static mode guard.                                                                                                                                       |
| Native credential store        | Existing Linux/macOS/Windows Node and SEA workflow is reused at the final SHA, including checksum-pinned helper fixtures and real disposable OS-store checks.                                                                                       |
| npm provenance                 | Retained tarball publication retains `--provenance`/OIDC; GitHub's signed SHA/ref remain the actual dispatch context; the retained archive independently binds the final candidate SHA. Readback also verifies npm `gitHead` and SHA-512 integrity. |
| Artifact identity/smoke        | Installed npm CLI, every supported SEA platform and basic/extended OCI amd64/arm64 pass version smoke; archives/digests are retained and read back.                                                                                                 |
| External policy/readiness      | Maintainer completes applicable compatibility/security/canary decisions before dispatch; MCP 2026 acceptance remains tracked in #485. Repository-hosted policy checks are distinct from this manual run.                                            |

Existing OCI build configuration has `provenance: false` and `sbom: false`, and no scanner step in these release workflows. The release workflow does not sign SEA archives. These settings do not provide scanning, SBOM or additional attestation coverage. Additional supply-chain policy requires a separate owner decision. See the [security model](https://docs.1mcp.app/reference/security) and [development guide](https://docs.1mcp.app/guide/development).
