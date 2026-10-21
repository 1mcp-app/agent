# Documentation site audit — 2026-10-21

## Scope and baseline

Reviewed `docs/site` against `fe8bb09b55cfa12dba25bcd2e0c2bc44e861ac99` (`origin/main`, including PR #668). The original checkout and its local ADR commit were preserved.

The inventory covered all 98 existing English/Chinese page pairs, locale navigation, generated pages, internal links, headings, command-option parity, and complete MCP configuration examples. Adding the reference landing pages brings the site to 99 pairs. Technical investigation focused on executable examples, configuration, installation/removal, operations, and internal-tool claims. Automated parity checks do not prove sentence-by-sentence translation equivalence or every runtime contract.

## Findings addressed

| Finding                                                                                                                                  | Evidence                                                                                                                         | Correction                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chinese MCP overview omitted registry workflows; preset pages omitted options, a workflow section, and related links                     | Locale page comparison                                                                                                           | Added matching Chinese sections and links                                                                                                             |
| Chinese server-management guide retained English sections                                                                                | `zh/guide/essentials/server-management.md`                                                                                       | Rewrote both guides around the same supported tasks, preserving the Admin Console workflow                                                            |
| English instruction-template links used nonexistent `/en/` routes                                                                        | VitePress English rewrite and page links                                                                                         | Used root English routes; normalized relative public links to absolute locale routes                                                                  |
| Seven distinct fragment targets were missing in rendered HTML                                                                            | Configuration and app-consolidation links                                                                                        | Repaired stale and untranslated anchor references                                                                                                     |
| STDIO examples treated command plus arguments as one executable, or used command arrays                                                  | MCP configuration schema and add command                                                                                         | Separated executable and arguments in both locales                                                                                                    |
| Environment-substitution example used an invalid `servers` array and put application auth settings in backend configuration              | Configuration schema and `src/config/runtimeTargetFingerprint.ts`                                                                | Used `mcpServers` and a valid backend-only example                                                                                                    |
| Configuration reference contradicted itself about CLI/environment precedence                                                             | Existing precedence section and runtime option handling                                                                          | Explicit CLI flags take precedence over environment defaults                                                                                          |
| Uninstall docs promised prompts, dependency validation, fixed shutdown sequencing, and a nonexistent CLI reload command                  | `src/commands/mcp/uninstall.ts`, `src/commands/mcp/utils/serverUtils.ts`, command registration                                   | Documented actual removal, backup, in-use-check, and reload-result behavior; corrected `--no-remove-config` and removed unsupported `-y` alias        |
| Install docs claimed integrity checks, dependency resolution, metadata persistence, and package upgrades not established by the workflow | `src/commands/mcp/install.ts`, `src/domains/installation/serverInstallationWorkflow.ts`, `serverInstallationSourceResolution.ts` | Explained configuration generation, preview, readiness checks, template conflicts, and registry-version/package-pin distinction                       |
| Enterprise guide contained unsupported secret-store syntax and operational guarantees                                                    | Configuration schema, environment processing, health and recovery references                                                     | Replaced with deployment choices, supported environment references, readiness boundaries, and operator responsibilities                               |
| Comparison page asserted unsupported costs, scale, compliance guarantees, connection pooling, and clustering                             | Architecture and performance contracts                                                                                           | Replaced with a concise responsibility/tradeoff comparison without vendor or benchmark claims                                                         |
| Discovery reference treated placeholder data as live registry and capability evidence                                                    | `src/core/tools/internal/discoveryHandlers.ts`                                                                                   | Explicitly documented static registry-info/list responses, generated capability names, ignored inputs, and the supported live-inspection alternatives |
| Management reference promised historical trends, zero-downtime rollback, syntax highlighting, and batch editing                          | Internal management schemas and handlers                                                                                         | Documented current snapshots, reload outcomes, edit preview, replacement semantics, and verification                                                  |

## Installed CLI examples

Shell examples now use the installed `1mcp` executable. JSON and TOML client launch examples use the same executable with package-runner arguments removed. Both installation guides retain an explicitly labeled `npx -y @1mcp/agent` alternative. Package runners for upstream MCP packages remain unchanged. The command index links to installation prerequisites.

## Independent review corrections

Two read-only reviews checked source correctness and user-facing compatibility. Four actionable findings were corrected in both languages:

- Install dry-run prints target/version and registry origin, not the generated launch configuration. The guide now states that limit and points to registry metadata, explicit `mcp add`, and the saved configuration as appropriate.
- `/health/mcp` loading diagnostics can expose backend errors and authorization URLs at minimal detail. Operations and health references now explain the endpoint-specific disclosure boundary and network restrictions.
- App consolidation still generates an `npx` launcher. The Claude Desktop guide now identifies the recommended installed-command launcher as a manual replacement before restarting the client.
- Existing docs tests expected the previous launcher and registry search example. The preset assertion now checks the installed CLI, the useful search filters were retained, and a regression check confines package-runner examples to installation alternatives.

## Navigation

Preserved every existing page path. Both locales now share the same navigation structure and collapse behavior.

Guide groups: Start Here; Connect Your Client; Configure Backends; Projects and Preparation; Deploy and Secure; Monitor and Recover; Customize Instructions; Contribute. The worktrees/cross-project guide from #668 is retained under Projects and Preparation.

Command groups: Overview; Runtime and Backends; Discover Servers; Filter with Presets; CLI Workflow; Project Lifecycle; Setup and Access; App Integration.

The top-level Reference link now opens a localized reference index instead of jumping directly to architecture. Every non-redirect guide, command, and reference page is reachable from its section sidebar. The legacy `reference/internal-tools.md` routing page remains available but is intentionally not duplicated in the menu.

## Validation

- Documentation build passed on the updated base: 199 generated HTML pages, including the 404 page.
- Existing SEO validation passed for sitemap, canonical URLs, social metadata, and the 16 specially checked pages.
- Rendered HTML link-fragment scan: zero broken internal anchors.
- All 99 locale pairs match in path inventory, heading-level sequence, documented long-option names, and internal page-link target sets. Localized fragment IDs are checked in rendered HTML rather than compared as literal strings.
- Locale navigation structure and collapse-state comparison passed; all 98 sidebar link occurrences resolve, and all non-redirect section pages are covered.
- All 48 parseable complete `mcpServers` JSON/JSON5 examples passed the generated MCP configuration schema. Partial examples and template-rendered values were not executed.
- Prettier passed across both locale trees and VitePress configuration.
- `git diff --check` passed.
- Repository lint and typecheck passed. The unchanged application build script passed when run directly with package-manager version switching disabled.
- Focused documentation tests passed (2 files, 5 tests), including the new installed-command regression check.
- The final full unit run passed 495 of 497 files (7744 passed, 3 failed, 4 skipped). Failures were in unchanged `schemaJourneys.test.ts` and `modernHttpRoutes.headerAdmission.test.ts`; both files then passed serially (11 tests). The prior unrestricted run had passed those runtime files and failed only the documentation assertions that were subsequently corrected. This is recovered test evidence, not a claim of a single fully green final full-suite run.
- Both independent reviewers completed bounded rechecks with no remaining actionable findings.

The installed pnpm launcher could not execute its configured pnpm 12.10.1 binary (`ENOEXEC`). The same repository scripts ran successfully using the available launcher with `npm_config_manage_package_manager_versions=false`; package files and dependency versions were not changed. Build-generated tracked schema changes were excluded from this documentation patch.

Existing non-fatal build warnings remain: `caddyfile` highlighting falls back to text, and some generated bundles exceed 500 kB. Neither warning was suppressed.

## Remaining verification boundaries

This changes documentation and its contract tests, not runtime behavior. Placeholder internal registry responses, ignored discovery inputs, and registry-version/package-pin behavior remain implementation limitations now described accurately. Follow-up implementation work would need its own contract and tests.

No third-party installations, destructive command examples, live provider workflows, deployment, or publication were executed. External links and current vendor behavior were not exhaustively checked. HTML and navigation structure were checked programmatically; no interactive browser visual/accessibility audit was performed. Application checks and the existing documentation contract tests are included in PR validation; live client acceptance remains separate.
