---
name: 1mcp-preparation-setup
description: Configure 1MCP backend preparation for selected projects and worktrees. Use when installing or adapting a preparation recipe, authoring a missing recipe or helper, enabling automatic preparation, or diagnosing recipe readiness. Covers dynamic MCP backends; ordinary MCP server launch setup uses mcp setup.
---

# Set up backend preparation

Deliver a configured recipe and evidence for its declared readiness scope. Installing this skill alone changes no backend settings. Use the installed 1MCP CLI and its current help and instructions; recipe support and native backend behavior vary by version.

## Establish the target

Identify the runtime (`--url` or `--context`, plus configuration location and filters), assigned checkout or selected project-set member, configured server name, native version, current recipe and effective permissions. Normal local calls use the verified startup or worker assignment and omit `--project` and `--project-owner`. Keep any explicit target override through discovery, preparation, schema inspection, and invocation; an override does not change the session default.

Follow current bootstrap guidance for ownership. Codex hosts with trustworthy thread lookup resolve their own owner automatically; hosts without that integration use their own bootstrap-provided `--project-owner` reference. Each worker needs its own explicit assignment and owner. Explicit `--url` calls remain credentialless unless an owner is explicitly supplied; local credentials do not authorize remote lifecycle controls. Resolve missing assignment before project-specific work.

Reuse current hook-delivered instructions; otherwise fetch scoped `1mcp instructions`. Inspect the server and applicable instructions, then tool schemas before invoking tools through `1mcp run`. `1mcp project prepare inspect <server>` checks readiness even when discovery is empty and does not start preparation. Native CLI help and read-only diagnostics can establish recipe behavior; upstream MCP calls stay routed through 1MCP.

Read only the matching backend reference: [CodeGraph](references/codegraph.md), [Code Review Graph](references/code-review-graph.md), or [Serena](references/serena.md). For other backends, discover their native public setup and readiness interfaces. These examples are conditional techniques, not bundled production recipes.

## Resolve or author the recipe

Reuse a compatible supplied recipe when available. Otherwise read the current [recipe contract](https://github.com/1mcp-app/agent/blob/main/docs/development/backend-preparation-recipes.md), checking it against the installed version. In a source checkout, use its matching document and schemas. Produce a named `configured-command` JSON definition and only the helper files needed to translate native behavior into that contract.

- Declare backend/version/platform compatibility, readiness scope, affected tools, supported actions, and helper identity. Keep machine-specific paths and inputs in runtime configuration. Commands use executable/argument arrays, literal placeholders, and the selected checkout as cwd; they are not shell command strings.
- Prefer native public commands. Validate recipe shape with the installed runtime's schema/loading path. The demonstration fixture proves the generic contract only; it is not an integration for a native indexer.
- Probes and optional progress commands must be read-only and bounded. For an index, check checkout identity, completeness, supported source coverage, and freshness including dirty and untracked additions, edits, and deletions. A file existing or a successful action exit is insufficient.
- Map verified states to `ready`, `required` with its supported action, or `conflict`. In the current contract, unknown readiness comes from an unmapped exit or failed check, not a configured `state: "unknown"`. Never translate uncertainty into ready.
- Establish native writer coordination and attached-process cancellation behavior. Preserve foreign locks and work. Do not infer those guarantees from 1MCP process containment or fixture success.
- Bump recipe/helper revisions when behavior changes; declare helper files so identity reflects their content. Avoid changing helpers during admitted jobs.

If native guarantees remain unverified, explain the specific limitation and affected scope. Experimental installation is allowed when the user explicitly accepts it, including acceptance already given in this task. Experimental status never licenses a false readiness result. A request to inspect or draft alone does not authorize activation.

## Apply authorized configuration

Back up the current configuration and compare it again before applying a scoped change. Preserve unrelated fields and existing explicit backend/project disables. Attach the named definition by matching ID and absolute file path to the existing server/template; keep `allowedActions` separate from the recipe's declared actions.

For requested automatic preparation across authorized checkouts, use a named definition with `activation: "setup"`. For project-only automatic preparation, retain project opt-in and update the effective `.1mcprc` by configured server name, respecting linked-worktree inheritance. Clarify activation scope only when it cannot be inferred from the request. Do not combine named and inline integration definitions.

Authorize only the requested actions. Installation, paid services, rebuilds, wider checkout access, and removal of explicit disables require their own applicable authorization. A denied action is not a reason to widen permissions. Read back effective runtime configuration and readiness after installation; a written file does not establish that the runtime loaded it.

## Verify and close out

Use an isolated checkout for source-changing checks. Verify the declared scope with a cold checkout, an already-ready checkout, supported source changes, and checkout isolation. Test conflict and failure behavior without interfering with foreign processes. If native concurrency/cancellation cannot be exercised, report that gap explicitly.

1. Inspect readiness for the exact target and operation. Start permitted work with `1mcp project prepare start <server>` only when needed.
2. Follow the returned job with `status` or bounded `wait --wait-ms 5000`. Keep the same runtime, project, owner, filters, and operation. A job performs one action; terminal failure or another required action needs diagnosis and deliberate retry, not a retry loop.
3. Verify the post-action probe. Refresh server discovery and inspect the tool schema, then submit a fresh tool call. Preparation never replays the original request. Check that the returned result belongs to the selected checkout and reflects the test source.
4. Release only task-owned bindings when their work is finished. For disposable checkout removal, follow current `project release` and manager/operator `project drain` guidance; require confirmed completion before removal and preserve other owners. Turn completion alone is not session termination. Do not add Git or client hooks as a side effect of recipe setup.

Report changed paths, activation scope and allowed actions, configuration/readback evidence, probe and real-tool results, and any unverified guarantees. Distinguish installed configuration, recipe readiness, and native usability. For rollback, disable just the server's `preparation.enabled` or the selected project's preparation preference; restore backups only after checking for intervening unrelated changes. Name retained verification resources and their blockers instead of claiming cleanup finished.
