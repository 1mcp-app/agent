---
title: Project Checkouts, Sets, and Worker Assignments
description: Select source checkouts and saved project sets, understand inherited configuration, and assign Codex or Claude workers explicitly.
---

# Project Checkouts, Sets, and Worker Assignments

For a complete setup-to-cleanup walkthrough, see [Working Across Projects and Worktrees](/guide/worktrees-and-cross-project-sessions).

Examples below use a supported Codex session with verified startup hooks: 1MCP resolves its owner and assigned project automatically. For Claude or hosts without automatic owner lookup, add `--project-owner <own-file>` using that caller’s bootstrap credential; workers use their own. Explicit project selectors below demonstrate overrides for another checkout. See [CLI setup](/commands/cli-setup#session-defaults-and-cleanup) for setup and fallback details.

Use explicit project selectors when one agent works across repositories or Git worktrees. Each call selects its source checkout while a shared local runtime manages the connections. Selecting a project does not change a runtime-global current project or dispatch the same tool call to every member.

Reuse known tool schemas within the session, including across projects, when the tool contract is unchanged. Keep project-specific instructions, readiness, authorization, and target selection current. Refresh server and tool inspection when information is missing, capabilities change, preparation completes, or relevant failures occur. Never automatically replay failed tool calls.

`--project` and `--project-set` are command-scoped options, supported by `bootstrap`, `instructions`, `inspect`, `run`, `proxy`, `wait`, project lifecycle commands except `recover`, and project preparation commands. Each `--project` consumes exactly one value; repeat it for project-set labels. Selectors may appear before or after a supported command, for example `1mcp --project /work/app inspect codegraph`. Other commands, including `serve` and `project recover`, reject them before execution.

## Project and owner options

These options apply to `instructions`, `inspect`, `run`, and project preparation/lifecycle commands:

| Option                      | Meaning                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--project <path-or-label>` | Select one checkout path, or a member label when using a project set. Repeat labels only for operations that support multiple members. |
| `--project-set <file>`      | Load a saved JSON project set; relative member paths resolve from this file's directory.                                               |
| `--project-owner <file>`    | Override automatic owner lookup when required, using this caller’s own bootstrap credential.                                           |

Keep the runtime and filters consistent. Calls for the assigned default project need no project or owner flags in a supported Codex session. A per-call project override does not change that default; retain the override throughout discovery, inspection, preparation, and invocation. The owner credential identifies the caller; it does not select a checkout or replace runtime authentication. Remote runtimes do not support local owner credentials. When overriding the default, retain project selectors for dynamic templates and checkout-specific calls. Static, project-independent server/schema inspection does not need them.

## Source Checkout and Configuration Source

A **Project Checkout** is the source directory the backend must query. Its **Project Configuration Source** supplies defaults such as preset and tag filters. These can be different directories:

| Checkout                             | Configuration used                                                | Source queried  |
| ------------------------------------ | ----------------------------------------------------------------- | --------------- |
| Main checkout with `.1mcprc`         | Main checkout's file                                              | Main checkout   |
| Linked worktree without a local file | Main checkout's file from the same Git repository, when available | Linked worktree |
| Linked worktree with a local file    | Local file as a whole                                             | Linked worktree |

A local file replaces inherited configuration; missing fields do not merge from the main checkout. For example, a worktree file containing only `{"tags":["frontend"]}` does not also inherit the main checkout's preset. If the main checkout's configuration is unavailable, the linked checkout remains the source target.

Automatic discovery searches within the current repository boundary. A configuration above that repository is not implicitly selected. Invocation from a nested directory can still find configuration inside its repository. Keep source identity separate from provenance when checking results: shared Git history or inherited settings do not prove that another checkout's index represents this checkout.

## Use the assigned checkout

In a supported Codex session, ordinary calls use the root session’s verified startup project or the worker’s explicit bootstrap assignment:

```bash
1mcp inspect codegraph
1mcp inspect codegraph/codegraph_explore
1mcp run codegraph/codegraph_explore --args '{"query":"Where are the API routes defined?"}'
```

Changing shell cwd does not change that session default. Without host integration, ordinary CLI calls use cwd instead. A worker still needs an explicit assignment before project-specific calls. An assigned multi-project set requires a member selection for single-checkout tools, such as `--project backend`.

## Select One Checkout

To override the assigned default without a project set, supply exactly one checkout path:

```bash
1mcp instructions --project /work/frontend
1mcp inspect --project /work/frontend
1mcp inspect codegraph --project /work/frontend
```

Ordinary CLI checkout paths may be relative to the invocation directory and are resolved to readable, traversable canonical directories. Existing single-checkout invocations can continue using their discovered default without `--project`. Worker dispatch assignments should use absolute paths to avoid a parent's invocation directory affecting selection.

Retain the selector on each `instructions`, `inspect`, and `run` call. Read applicable server instructions and inspect the tool schema if it is not already known:

```bash
1mcp inspect codegraph/codegraph_explore --project /work/frontend
1mcp run codegraph/codegraph_explore --project /work/frontend --args '{"query":"Checkout-specific symbol"}'
```

These commands require the named server and tool to be configured and available. Target selection preserves the runtime's existing authentication, authorization, and template-context trust requirements.

## Save a Project Set

Create a JSON definition such as `/work/feature-projects.json`:

```json
{
  "name": "feature",
  "projects": [
    { "label": "frontend", "path": "./frontend" },
    { "label": "backend", "path": "./backend-worktree" }
  ]
}
```

`name` is optional. A set contains 1–32 members with unique labels; labels are limited to 128 characters and paths to 4,096 characters. The file is limited to 64 KiB. Relative member paths resolve from the definition file's directory, and each member must resolve to a readable, traversable directory. Saving the file does not activate a global project switch; independent sessions select it explicitly.

Select a member by its label:

```bash
1mcp instructions --project-set /work/feature-projects.json --project frontend
1mcp inspect --project-set /work/feature-projects.json --project backend
```

The definition may include an optional default `"selection": ["backend"]`. CLI `--project` labels override that saved selection. Repeated labels preserve the requested order:

```bash
1mcp inspect --project-set /work/feature-projects.json --project backend --project frontend
```

A one-member set defaults to that member. A multi-member set without either saved `selection` or explicit labels has unresolved checkout selection. Checkout-specific operations require a selection and report the available labels; project-independent tools do not need one. Unknown or duplicate selected labels are rejected.

## Match the Backend's Target Contract

Runtime server configuration can declare `projectTarget` metadata:

| Mode          | Selection and tool arguments                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `single`      | Select one checkout. A configured `argument` receives its path; otherwise a target-bound template supplies the checkout context. |
| `native-set`  | The upstream tool natively accepts selected checkout paths together. Required `argument` receives an ordered array of paths.     |
| `independent` | The backend needs no checkout target; no project argument is injected.                                                           |

For example, an upstream tool whose schema accepts a `projects` array can be configured with:

```json
{ "projectTarget": { "mode": "native-set", "argument": "projects" } }
```

This metadata must match the upstream schema; declaring it cannot give a single-project backend multi-project support. Templates default to `single`; static servers default to `independent`. A static server declared `single` needs an explicit target argument or must become a target-bound template. A supplied tool argument that conflicts with the selected target is rejected.

For a single-project backend, coordinate separate calls with one label each. For a native combined call, select the intended labels together. The backend must be permitted under every selected checkout's effective preset/filter settings. Target selection does not broaden authentication or authorization. Concurrent targets use separate prepared bindings where needed; mutable upstream project state must remain isolated.

## Assign Each Worker Explicitly

Include an absolute checkout path, or an absolute project-set definition path and selected labels, in every delegated worker's dispatch instructions. For example:

> Your Worker Project Assignment is `/work/feature-projects.json`, label `backend`. Before project-specific discovery, run `1mcp bootstrap --client codex --event SubagentStart --project-set /work/feature-projects.json --project backend`. Bootstrap records this assignment as the worker’s default; subsequent calls can omit these selectors.

Workers assigned several members can repeat `--project` labels, then use one label per single-project call or the selected labels for a supported native combined call. For Claude, use `--client claude` and add that worker’s own bootstrap `--project-owner <own-file>`.

[`cli-setup`](/commands/cli-setup) configures managed `SessionStart` and `SubagentStart` handlers for the selected client and scope. `SessionStart` can fetch ordinary runtime instructions. Each worker receives the inspect-before-run playbook independently. The supported client hook payloads carry identity and cwd, but no project assignment field; the worker therefore obtains its assignment through dispatch instructions and an explicit bootstrap invocation.

An unassigned `SubagentStart` hook reports unresolved selection and supplies the general playbook. It does not choose the parent's checkout from cwd or session identity. Global and repository hook sources may both deliver instructions; repeat delivery does not suppress another worker's assigned target.

Bootstrap requires explicit CLI assignment flags. Its option parser ignores inherited `ONE_MCP_*` options, and the instructions subprocess strips inherited `ONE_MCP_PROJECT` and `ONE_MCP_PROJECT_SET` without modifying the parent environment. Ordinary project selection in other commands keeps its existing option behavior.

## Check Coverage Before Tool Use

Generated hook files alone do not prove that hooks are enabled, trusted, or executed. Verify that the selected client actually receives additional context for both events. Disabled or untrusted hooks, unavailable runtime instructions, oversized hook input, and unresolved assignments remain bootstrap coverage gaps. Valid explicit assignments and successfully fetched instructions are delivered in full. Runtime instructions exceeding 9,000 characters trigger an advisory asking the agent to recommend presets for fewer servers in future sessions; they are not omitted or truncated.

Check checkout-specific backend evidence before relying on results. A connected backend, successful bootstrap, or index for another checkout does not prove index coverage for the selected source. This guide describes selection and bootstrap; backend preparation requires its own supported policy and readiness checks.

See also [CLI mode](/guide/integrations/cli-mode), [configuration](/guide/essentials/configuration), and [CLI setup](/commands/cli-setup).
