---
name: 1mcp-cli
description: Discover and invoke MCP tools through the 1MCP CLI. Use before operating 1MCP-managed servers, including project selection, backend readiness, and caller lifecycle recovery. Preparation recipe configuration belongs to 1mcp-preparation-setup.
---

# Use 1MCP tools

Route upstream MCP capabilities through the 1MCP CLI. Reuse current hook-delivered context for the same assigned target; compact bootstrap output is a server overview, not the server manuals.

## Select the target

Normal local calls omit `--project-owner` and `--project`: use the verified startup or worker assignment and your own caller ownership. A per-call override does not change that default. Retain explicit runtime, filters, and target overrides throughout discovery, instruction loading, schema inspection, and invocation.

Read [project and worker ownership](references/ownership.md) before dispatching workers, switching projects or runtimes, selecting project-set members, or resolving missing ownership. Each worker needs independent ownership and an explicit assignment. Resolve bootstrap coverage gaps before project-specific calls; configuration files do not prove trusted hooks or readiness.

## Discover and invoke

1. If the provider or tool is unknown, use `1mcp inspect --search <query>` or `1mcp inspect <server> --search <query>`. Skip discovery when the target is known.
2. Read `1mcp instructions <server>` before using that server unless its current instructions for the selected target are already available. Empty instructions and unavailable instructions are different outcomes: resolve reported availability or authorization gaps.
3. Inspect unknown tool schemas with `1mcp inspect <server>/<tool>`.
4. Invoke with `1mcp run <server>/<tool> --args '<json>'` using the inspected schema.

Reuse unchanged tool schemas within a session, including across projects. Refresh project-specific instructions, readiness, authorization, and target selection when they change; refresh discovery/schema after preparation or relevant failures. Never automatically replay failed calls.

Search is case-insensitive literal substring matching. Use quoted `--search "filesystem/*read?" --glob` for whole-reference matching with `*` and `?`. `--include-descriptions` broadens search to descriptions; `--show-descriptions` only displays them. Narrow the server set with `--preset`, `--tags`, or `--tag-filter` when appropriate.

For a loading static server (`type: external`), use `1mcp wait <server>`. For backend preparation requirements, including an unavailable dynamic server (`type: template`), read [preparation operations](references/preparation.md). Authenticate only with an authorized credential for the selected runtime; consult `1mcp auth login --help` rather than changing targets to bypass a denial.

## Finish or recover

Read [release and recovery](references/recovery.md) before releasing owned bindings, recovering terminal cleanup, or draining a project. Workers explicitly release their own bindings when finished. Turn completion is not SessionEnd and does not authorize deleting owner records.

Use a private task directory under the OS temporary directory for scratch files and payloads. Let 1MCP manage owner records; resolve scoped permission failures rather than copying credentials or bypassing ownership.
