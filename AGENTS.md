# AGENTS.md

1MCP aggregates MCP servers behind one endpoint. Repository: `1mcp-app/agent`; public docs: <https://docs.1mcp.app>.

## Start with the relevant context

- Before exploring a domain, read [docs/agents/domain.md](docs/agents/domain.md), use the vocabulary in `GLOSSARY.md` when present, and consult the relevant decisions in `docs/adr/`.
- Before editing anything under `docs/`, read [docs/AGENTS.md](docs/AGENTS.md). It defines public URL preservation, bilingual changes, development-note placement, and site verification.
- For issue or PRD work, read [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md); for triage labels, read [docs/agents/triage-labels.md](docs/agents/triage-labels.md).
- For setup and development workflows, consult [the development guide](docs/site/en/guide/development.md). Use `.node-version` and the `packageManager` field in `package.json` for toolchain versions; `package.json` scripts and `.github/workflows/` define executable checks.

## Scope and completion

- Preserve existing staged and unstaged changes. Carry the authorized task through implementation, verification, and requested delivery; keep commits, pushes, PR creation, merge, and deployment within the user's authorization.
- Resolve routine, reversible choices from current source and repository conventions. Ask when an unresolved decision materially changes behavior, compatibility, scope, or external effects; continue independent authorized work while it is unresolved.
- Report the changed behavior, checks actually run, and unresolved failures or coverage gaps. Local validation, hosted CI, and deployment are separate results. “Verify” and “confirm” require evidence, not a human approval checkpoint unless explicitly requested.

## Development and verification

Run commands from the repository root. Install dependencies with `pnpm install`. `pnpm dev` starts the development watcher and creates `.env` from `.env.example` if absent; preserve any existing `.env`.

| Task                                        | Command / rule                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Build                                       | `pnpm build`                                                                                 |
| Focused source tests                        | `pnpm test:unit <path/to/file.test.ts>`; source tests are co-located                         |
| Admin UI                                    | `pnpm test:admin` and `pnpm typecheck:admin`                                                 |
| Required before committing                  | `pnpm check`                                                                                 |
| Documentation changes                       | `pnpm docs:build`                                                                            |
| Process, HTTP, browser, or protocol changes | Build first, then choose the relevant E2E lane from [test/e2e/README.md](test/e2e/README.md) |

`pnpm check` runs static/build checks, source and Admin tests, release tests, and the permission guard. It does not include the docs build, E2E, or protocol conformance suites. Select additional checks for the affected behavior from `package.json` and the relevant CI workflow; diagnose failures rather than waiving a gate.

Reuse existing fixtures and `test/unit-utils/MockFactories.ts`. For command tests, use the E2E harness's isolated configuration, temporary state, loopback ports, and owned subprocess teardown. Keep manual experiments isolated with a task-specific `ONE_MCP_CONFIG_DIR`; never exercise mutations against the user's live configuration. Use the SDK client for protocol journeys instead of incomplete hand-written JSON-RPC examples.

## Implementation conventions

### Control flow

- Make each branch express one decision. Prefer guard clauses and early returns over nested `if/else` chains.
- Split conditions that mix concerns or require unpacking `&&`, `||`, and negation. Use sequential checks or a straightforward named domain predicate.
- Keep ordinary two-way `if/else` when clearer. Avoid nested ternaries and boolean flags that make one function perform different workflows.
- Extract functions around meaningful decisions or steps, not wrappers that hide complicated expressions. Avoid unnecessary dispatch tables, classes, or abstractions.
- Preserve validation, short-circuit order, side effects, and failure behavior during refactoring; verify the affected behavior.

### Configuration and CLI

- Route user-facing `ONE_MCP_*` settings through the existing yargs/configuration pipeline rather than adding ad hoc `process.env` reads in business logic. Keep environment plumbing at its existing boundaries.
- Validate external inputs with the existing Zod schemas before applying configuration changes.
- Follow neighboring command builders and handlers in `src/commands/`. Keep option registration, validation, help text, focused tests, and affected public command docs aligned. Add E2E coverage when behavior crosses a process or protocol boundary.

### SDK boundaries

Keep legacy `@modelcontextprotocol/sdk` dependencies inside `src/sdk/legacy/`. Before changing SDK imports or compatibility shims, read [the import policy](scripts/sdk-boundary/import-policy.mjs) and [topology checks](scripts/check-sdk-topology.mjs); preserve their enforced boundaries rather than copying imports from an unrelated transport implementation.

### Logging and output

Use registered event names and declared fields from `src/observability/events/registry.ts` through `src/logger/logger.ts`. Use conditional callback helpers for expensive field construction; simple events need no callback. Preserve the privacy normalization in `src/observability/events/normalize.ts` and `src/observability/privacy/fields.ts`. Keep user-facing CLI output in the existing printer layer and protocol output free of diagnostic text.
