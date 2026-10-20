---
title: Working Across Projects and Worktrees
description: Set up local agent sessions, work across frontend and backend checkouts, assign workers, prepare backends, and safely release a worktree.
---

# Working Across Projects and Worktrees

Use this walkthrough when one feature spans several repositories or Git worktrees. You will keep the frontend in `/work/frontend`, create a feature worktree from `/work/backend`, and give each worker an explicit target. One local 1MCP runtime manages the backend connections.

## Who runs each step?

**You** install tools, configure the runtime/client, and choose projects and preparation permissions. **The AI agent** runs discovery, tool calls, preparation controls, and its own release after bootstrap. **The local operator or worktree manager** drains and removes checkouts, or resumes them. An agent may perform operator steps when you authorize that work and it has the required local authority.

Command blocks below identify the intended caller. You do not need to manually repeat blocks marked **AI agent**; they show the workflow your agent follows. Startup hooks run automatically through the client. The explicit worker bootstrap example is for the worker to resolve its assigned project.

## 1. Install and configure backends with `mcp setup`

You need Git, local Codex or Claude Code with command hooks, and a 1MCP build that includes project selection and the `project` lifecycle commands. Follow [Installation](/guide/installation), then check:

**You — setup**

```bash
1mcp --version
1mcp project --help
1mcp project prepare --help
```

If these commands are absent, install a build that includes them; see [Installation](/guide/installation). Use the same build for the agent’s `1mcp` executable and local runtime.

Examples use Bash or Zsh on Linux/macOS. Replace `/work` with your own absolute workspace directory. Windows users must adapt shell syntax; automatic preparation and verified backend cleanup have additional limitations described in the linked references.

Install the backend you want to use, including its language dependencies, following its own installation instructions. This walkthrough uses CodeGraph as an example; it is not a requirement for project selection. Configure the installed executable as a reusable template:

**You — setup**

```bash
1mcp mcp setup --known codegraph --dry-run
1mcp mcp setup --known codegraph
```

`mcp setup` writes the backend's launch configuration to `mcp.json`. With no arguments, it offers an interactive choice; `--known` selects one maintained example directly:

| Backend           | Setup command                              | What you install first                              |
| ----------------- | ------------------------------------------ | --------------------------------------------------- |
| CodeGraph         | `1mcp mcp setup --known codegraph`         | The `codegraph` executable.                         |
| Code Review Graph | `1mcp mcp setup --known code-review-graph` | The `code-review-graph` executable.                 |
| Serena            | `1mcp mcp setup --known serena`            | Serena and the language servers your projects need. |

Choose the backend you need; you do not need all three. By default, setup saves a reusable entry under `mcpTemplates`, named after the selected example. Use `--name` to choose another name and use that name in later commands. The template binds its working directory and source target to the checkout selected for each call.

On Linux/macOS the default file is `~/.config/1mcp/mcp.json`; on Windows it is `%APPDATA%/1mcp/mcp.json`. If you already use `--config` or `--config-dir`, pass the same selector to setup and edit that configuration file. Setup reports the saved change and reload observation. An equivalent setup is a no-op; use `--force` only when you intend to reconfigure an existing entry. It preserves unrelated overrides and preparation settings.

Review the preview before saving. If the executable is not on PATH, add `--executable /absolute/path/to/codegraph` to both commands. Omit `--checkout`: that option creates a fixed checkout configuration. Setup does not install CodeGraph, initialize indexes, or supply an automatic preparation recipe. Complete native initialization for each source checkout before querying it, or use a supplied recipe in step 6. See [mcp setup](/commands/mcp/setup).

Start your local runtime in another terminal if it is not already running:

**You — setup**

```bash
1mcp serve
```

Use the same runtime and configuration throughout. The examples below use its default local discovery; if you use `--context` or `--url`, carry that same option through bootstrap, discovery, preparation, and cleanup. Existing authentication and project access requirements still apply.

## 2. Enable the client workflow

Choose the command for your client:

**You — setup**

```bash
1mcp cli-setup --codex
# Or, for Claude Code:
1mcp cli-setup --claude
```

These commands install global bootstrap guidance and hooks. For repository-scoped setup, see [CLI setup](/commands/cli-setup). For Codex, apply the hook/sandbox configuration snippet printed by setup. Enable and trust the installed hooks in your client, then start a new session. Use [CLI mode](/guide/integrations/cli-mode) for this workflow and remove duplicate direct 1MCP MCP entries from the same client scope.

Verify that startup actually delivers the 1MCP playbook and a private `--project-owner` credential reference. Hook files alone do not prove delivery. A worker also needs its own startup context and credential. If either is missing, resolve the reported hook or runtime error before continuing; do not invent an owner file or copy the parent's credential.

In each session's shell, set this convenience variable to the **actual absolute credential path from that session's bootstrap output**:

**AI agent**

```bash
SESSION_OWNER='/absolute/path/from/this-sessions-bootstrap.json'
```

This variable is only shorthand for the examples. If tool calls use separate shells, pass the actual path each time. Do not commit or share the credential. Retain it on every subsequent 1MCP call, including bootstrap retries.

### `bootstrap` and `instructions`: which one runs?

`bootstrap` is the client lifecycle entrypoint; `instructions` fetches the runtime playbook and server guidance. **Both commands are supported. `bootstrap` does not replace or deprecate `instructions`.**

| Situation                                                      | Caller and command                                                                             | What happens                                                                                                                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A session or worker starts                                     | The client hook runs `bootstrap`                                                               | Uses the hook identity to create that caller's owner credential, and delivers guidance in the client's hook response. With a resolved target, it calls `instructions` to obtain runtime guidance. |
| A worker's startup target was unresolved                       | The worker agent reruns `bootstrap` with its explicit assignment and existing owner credential | Delivers guidance for the assigned target. This manual retry does not create a new owner credential without verified hook identity.                                                               |
| Current target guidance was not delivered, or needs refreshing | The AI agent runs `instructions` with its project, runtime, and owner selectors                | Fetches runtime guidance directly. It does not create a hook owner credential or perform session lifecycle cleanup.                                                                               |
| Current target guidance was already delivered                  | The AI agent proceeds to `inspect`, then `run`                                                 | No second `instructions` call is needed.                                                                                                                                                          |
| A session ends                                                 | The client hook runs `bootstrap --event SessionEnd`                                            | Releases that session's recorded bindings; it does not fetch instructions.                                                                                                                        |

The normal startup flow is `client hook → bootstrap → instructions → agent receives guidance`. After successful delivery, the agent starts with `inspect`. The standalone `instructions` examples below are conditional fetches, not an extra mandatory step after bootstrap. If an owner credential is missing, repair hook delivery; running `instructions` alone does not restore ownership.

### Why keep `--project-owner`?

The project selector answers **which source checkout?** The owner credential answers **which session or worker is using it?** They solve different problems.

For example, two workers can use `/work/backend-feature` at the same time. When worker A finishes, `project release` with A's credential releases A's bindings while preserving B's work. A checkout path alone cannot distinguish those callers. Keeping the same credential across discovery, tool calls, and preparation records those bindings under the right owner so they can be released later.

The startup hook creates the credential; you do not generate or edit it. Your agent normally receives and carries the flag automatically. You only substitute the bootstrap-provided path when copying these commands manually. Each worker receives a separate credential. It does not choose a project, replace runtime authentication, or grant operator permission to drain a checkout. This guide covers local runtimes; local ownership credentials are not supported by remote runtimes.

## 3. Create the backend worktree

Assume `/work/frontend` and `/work/backend` are existing Git checkouts with a commit. Create a new feature branch and linked checkout:

**You / worktree manager**

```bash
git -C /work/backend worktree add -b feature/cross-project /work/backend-feature
```

If `/work/backend-feature` has no local `.1mcprc`, 1MCP can inherit `/work/backend/.1mcprc`. It still queries **the feature worktree's source**. If `.1mcprc` is tracked in Git, the new checkout normally already contains its own copy, which takes precedence.

To customize the worktree, place a complete configuration in `/work/backend-feature/.1mcprc`. Choose **one** server-selection method. For an existing preset named `development`:

```json
{ "preset": "development" }
```

Or, to select servers you have tagged `code`, use this alternative file:

```json
{ "tags": ["code"] }
```

Use your actual preset or tag names. Do not combine `preset` and `tags` in the same configuration. You can omit `.1mcprc` when you need no local override. A local file replaces the inherited file as a whole; omitted fields are not merged. Invalid local configuration fails instead of falling back. See [Project checkouts and sets](/guide/project-checkouts) for inheritance details.

## 4. Select and query each project

### Choose `--project` or `--project-set`

| Your task                                                                                | What to pass                                                                     | Meaning                                                                                |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Work in one repository or worktree                                                       | `--project /work/backend-feature`                                                | Select that checkout directly. No project-set file is needed.                          |
| Repeatedly work across named repositories                                                | `--project-set /work/feature-projects.json --project backend`                    | Load the set and select its `backend` member.                                          |
| Assign multiple members to a worker, or call a backend with native multi-project support | `--project-set /work/feature-projects.json --project frontend --project backend` | Select those members in that order. Single-project tools still require separate calls. |

Start with a direct path for a single checkout:

**AI agent**

```bash
1mcp inspect codegraph --project /work/backend-feature --project-owner "$SESSION_OWNER"
```

Use a saved set when stable names make cross-repository work or worker assignments easier. `--project-set` names the **definition file**, not a repository; `--project` then names a **member label**, not a path. Loading the file does not change the session's global working directory or call every project. A multi-member set requires explicit labels or a saved `selection` for checkout-specific calls; explicit labels override the saved selection.

### Save the frontend/backend set

Save this complete JSON as `/work/feature-projects.json`:

```json
{
  "name": "cross-project-feature",
  "projects": [
    { "label": "frontend", "path": "./frontend" },
    { "label": "backend", "path": "./backend-feature" }
  ]
}
```

Relative paths resolve from the JSON file's directory. With a project set, `--project` selects a **label**; without a set, it selects a checkout path. This set deliberately has no default selection, so each checkout-specific call must name its target.

If hooks have not already delivered instructions for the assigned target, fetch them. Then inspect the configured server and tool before calling it:

**AI agent**

```bash
# Only if current target instructions were not already delivered:
1mcp instructions --project-set /work/feature-projects.json --project frontend --project-owner "$SESSION_OWNER"
1mcp inspect codegraph --project-set /work/feature-projects.json --project frontend --project-owner "$SESSION_OWNER"
1mcp inspect codegraph/codegraph_explore --project-set /work/feature-projects.json --project frontend --project-owner "$SESSION_OWNER"
1mcp run codegraph/codegraph_explore --project-set /work/feature-projects.json --project frontend --project-owner "$SESSION_OWNER" --args '{"query":"Where does the frontend call the backend API?"}'
```

Repeat for the backend worktree:

**AI agent**

```bash
# Only if current target instructions were not already delivered:
1mcp instructions --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
1mcp inspect codegraph --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
1mcp inspect codegraph/codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
1mcp run codegraph/codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER" --args '{"query":"Where are the backend API routes defined?"}'
```

The example requires CodeGraph to expose `codegraph_explore` with a `query` argument. Use the schema returned by your installed server. Confirm that results describe files in the selected checkout and that its index covers current source. A connected server or an index in the main checkout does not establish worktree readiness.

Selecting `--project frontend --project backend` does not broadcast a call or change a global current project. Single-project tools need separate calls, as above. Only a backend with native project-set support can receive both targets in one call. Dynamic templates retain project selectors even during inspection; static, project-independent server/schema inspection does not need a checkout selector.

## 5. Assign workers independently

You or the coordinating AI agent give each worker a concrete assignment in its dispatch prompt. The **worker AI agent** runs the bootstrap command in this example:

> Your Worker Project Assignment is `/work/feature-projects.json`, label `backend` (checkout `/work/backend-feature`). Work only on the backend part of this feature. Use your own bootstrap-provided owner credential. Before project-specific discovery, run `1mcp bootstrap --client codex --event SubagentStart --project-set /work/feature-projects.json --project backend --project-owner YOUR_OWN_CREDENTIAL_PATH`. Retain this selection and your credential on subsequent calls. Inspect the server and tool schema before running tools. Release your own backend binding when your assignment is finished.

For the frontend worker, use label `frontend` and checkout `/work/frontend`. For a worker assigned a direct path, replace `--project-set ... --project backend` with `--project /work/backend-feature`. Use `--client claude` for Claude Code.

The worker replaces `YOUR_OWN_CREDENTIAL_PATH` with the credential supplied by its own verified startup hook. The explicit bootstrap call resolves the assignment; a parent's cwd or session identity is not an assignment. If startup already delivered the correct assignment and instructions, avoid fetching them again.

Each worker sets `SESSION_OWNER` to its own credential and follows step 4 for its selected target. Do not pass the parent shell's value to a child worker. Concurrent workers may select different checkouts without changing one another's target.

## 6. Prepare a backend when needed

Skip this step if native setup is complete and no preparation recipe is configured. **1MCP does not bundle automatic preparation recipes for CodeGraph, Code Review Graph, or Serena.** If your team supplies one, configure it using [Backend preparation](/guide/backend-preparation), including its supported actions and permissions.

### Configure the recipe in `mcp.json`

**You — configuration and permissions.**

First obtain a recipe and any helper files from your team or integration maintainer. The recipe defines how to check readiness and run supported actions. The `preparation` block below references that file; it does not create a recipe. If you do not have one, use native initialization rather than copying a nonexistent recipe path.

Open the same `mcp.json` that `mcp setup` updated in step 1. Add `preparation` **inside the existing `mcpTemplates.codegraph` entry**, alongside `command`, `args`, and `cwd`. This complete example shows its placement. Preserve your existing executable, environment, template options, and other servers; do not replace your entire file with this example.

::: v-pre

```json
{
  "mcpServers": {},
  "mcpTemplates": {
    "codegraph": {
      "command": "/absolute/path/to/codegraph",
      "args": ["serve", "--mcp", "--path", "{{{project.path}}}", "--no-watch"],
      "cwd": "{{{project.path}}}",
      "env": {
        "CODEGRAPH_NO_DOWNLOAD": "1",
        "CODEGRAPH_NO_DAEMON": "1"
      },
      "template": { "shareable": true, "perClient": false },
      "preparation": {
        "adapter": "configured-command",
        "definition": {
          "id": "team-codegraph",
          "file": "/absolute/path/to/recipes/codegraph.json"
        },
        "activation": "setup",
        "allowedActions": ["initialize", "sync"]
      }
    }
  }
}
```

:::

Replace `/absolute/path/to/codegraph` with your installed executable. Replace `team-codegraph` with the ID declared by the supplied recipe and `definition.file` with its absolute local path. These are placeholders, not a bundled CodeGraph integration. If the recipe declares machine-specific inputs, add `definition.inputs` using exactly its documented names and values.

| Setting                               | Effect                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `adapter: "configured-command"`       | Runs the recipe's readiness probe and permitted commands.                                                                         |
| `definition.id` and `definition.file` | Select the supplied recipe by its declared ID and absolute file path. Keep its helper files in the layout supplied by its author. |
| `activation: "setup"`                 | Enables automatic preparation for authorized checkouts using this backend, without adding an opt-in to each project.              |
| `allowedActions`                      | Limits which recipe actions may run. Include `initialize` and `sync` only if the recipe supports them and you permit them.        |

Save the configuration and check the next readiness inspection. A successful reload is not proof that an index is ready. Neither a recipe nor activation grants access to additional checkouts or permission to install dependencies, rebuild everything, or use paid services.

### Choose whether preparation applies to each project

**You — project preferences.**

For automatic preparation only in selected projects, **omit `activation: "setup"` from the server entry** and opt in through the selected checkout's `.1mcprc`:

```json
{
  "preparation": {
    "codegraph": { "enabled": true }
  }
}
```

With setup-wide activation, disable it for one checkout instead:

```json
{
  "preparation": {
    "codegraph": { "enabled": false }
  }
}
```

The key `codegraph` is the configured server name, not the recipe ID. Add this preference to the checkout's complete effective configuration, preserving its chosen preset **or** tags. A worktree-local `.1mcprc` replaces inherited settings as described in step 3. Project opt-in does not add allowed actions; an explicit project disable wins over setup-wide activation. To disable preparation for the backend everywhere, set `enabled: false` inside its `preparation` block in `mcp.json`.

### Inspect, prepare, and retry the tool

The following example assumes that recipe is configured for `codegraph` and covers `codegraph_explore`. Substitute your recipe's configured backend and operation names when different:

**AI agent**

```bash
1mcp project prepare inspect codegraph --operation codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
1mcp project prepare start codegraph --operation codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
```

Inspection does not start preparation. Start only a permitted action when readiness requires it. If a job ID is returned, replace `JOB_ID` below with that ID:

**AI agent**

```bash
1mcp project prepare wait codegraph JOB_ID --operation codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER" --wait-ms 5000
```

Repeat bounded waits while queued or running. Preserve the same runtime, filters, target, owner, and operation. A finished command is not enough: require verified readiness. On failure, read the reason and deliberately retry only after resolving it. Once ready, repeat server/schema inspection and submit a **fresh** tool call from step 4. Preparation never replays the original request.

## 7. Release and remove the worktree

When a worker finishes its assignment, it releases its own selected binding:

**AI agent — each caller releases its own bindings**

```bash
1mcp project release --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER" --format json
```

The frontend worker uses `--project frontend`. The parent also releases every selection it used, with its own credential:

**AI agent — each caller releases its own bindings**

```bash
1mcp project release --project-set /work/feature-projects.json --project frontend --project backend --project-owner "$SESSION_OWNER" --format json
```

Release protects other owners. A nonzero exit can mean cleanup is still pending; inspect the returned blockers. `SessionEnd` offers bounded session cleanup, but `Stop` and `SubagentStop` are not terminal events. Workers must explicitly release when finished, not after every response.

Before removing `/work/backend-feature`, an authorized local operator closes admission in the **same runtime**:

**Local operator / worktree manager**

```bash
1mcp project drain --project /work/backend-feature --project-owner "$SESSION_OWNER" --wait-ms 5000 --format json
1mcp project status --project /work/backend-feature --project-owner "$SESSION_OWNER" --format json
```

Require a successful drain exit and `complete: true` in its result for this checkout. Status can exit zero while blockers remain. Drain lets admitted work finish; it does not automatically cancel jobs. Other owners, subscriptions, shared backends, or unresolved preparation recovery can block cleanup. Resolve the reported blockers and retry drain. On Windows, a live stdio backend can remain a blocker when graceful exit cannot be verified.

After runtime cleanup completes, check for other runtimes or unrelated processes using the directory and preserve your work. Then use ordinary Git removal:

**Local operator / worktree manager**

```bash
git -C /work/backend worktree remove /work/backend-feature
```

Do not force removal to bypass dirty files or lifecycle blockers. 1MCP does not delete directories, indexes, or configuration, and its completion result applies only to the selected runtime. Remove the obsolete `backend` member from your project-set file after removal, or update it to an existing checkout before reusing the set.

If you abandon removal, explicitly reopen admission:

**Local operator / worktree manager**

```bash
1mcp project resume --project /work/backend-feature --project-owner "$SESSION_OWNER" --format json
```

A timeout leaves the checkout draining. The barrier survives runtime restart and deletion/recreation of the same path; `resume` is required before reuse and does not start or prepare a backend. See [Project lifecycle](/commands/project/) for detailed results and blockers.

## Troubleshooting

| Symptom                               | Next step                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Selection is unresolved               | Select a label from the set on each checkout-specific call; give every worker an explicit assignment.                                  |
| Results describe the wrong checkout   | Check the set's resolved paths, local `.1mcprc`, template versus fixed-checkout setup, and native index freshness.                     |
| No playbook or owner credential       | Verify hooks are enabled/trusted and executed in the actual client; resolve bootstrap errors before project-specific calls.            |
| Preparation is unavailable or blocked | Check whether a recipe exists, supports this operation/platform, and permits the action; otherwise complete native setup.              |
| Cleanup remains pending               | Read `blockers`, have every owner release, and let admitted work finish. Require successful drain and `complete: true` before removal. |
| Checkout remains draining             | Use explicit operator `project resume` if removal was abandoned; restarting the runtime does not reopen admission.                     |
