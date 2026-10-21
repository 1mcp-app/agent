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

Setup saves a reusable `codegraph` entry under `mcpTemplates` in `mcp.json`. Each call binds it to the selected checkout. Omit `--checkout`, which creates a fixed target. If the executable is not on PATH, add `--executable /absolute/path/to/codegraph` to both commands.

On Linux/macOS the default file is `~/.config/1mcp/mcp.json`; on Windows it is `%APPDATA%/1mcp/mcp.json`. If you use `--config` or `--config-dir`, pass the same selector to setup and the runtime. Setup does not install the backend or initialize indexes. See [mcp setup](/commands/mcp/setup) for other maintained backends, naming, and reconfiguration options.

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

Verify that startup delivers the 1MCP playbook and establishes session ownership. Hook files alone do not prove delivery. Resolve reported ownership or assignment gaps before project-specific calls; do not invent an owner file or copy a parent’s credential.

The commands below assume a supported Codex session with verified hooks. 1MCP automatically finds that session’s owner and assigned project. Normal calls need neither `--project-owner` nor `--project`; the cross-project examples retain target selectors because they deliberately query other checkouts. A per-call override never changes the assigned default.

### `bootstrap` and `instructions`: which one runs?

The client hook runs `bootstrap`, which creates the caller's owner credential and fetches runtime guidance through `instructions`. Once the agent receives guidance for its target, it proceeds to `inspect` and `run`. It runs `instructions` only when guidance is missing or needs refreshing. Missing credentials require repairing hook delivery; `instructions` does not create them. See [CLI setup](/commands/cli-setup) for lifecycle events and manual bootstrap retries.

### When is `--project-owner` needed?

Claude and Codex hosts without a trustworthy thread locator or both-ID integration must add `--project-owner <own-file>` to subsequent calls and manual bootstrap retries. Replace `<own-file>` with the actual private credential reference from that caller’s startup hook. Each worker uses its own credential; never share or commit it. See [session defaults and cleanup](/commands/cli-setup#session-defaults-and-cleanup).

Automatic ownership applies to named or implicit local targets. An explicit `--url`, including loopback or SSH forwarding, needs an explicit owner reference to attach local ownership. Remote runtimes do not support local owner credentials. Terminal cleanup recovery also requires `project recover --project-owner <ended-own-file>`; do not substitute a live caller’s credential. Ownership does not replace runtime authentication or grant operator permission.

## 3. Create the backend worktree

Assume `/work/frontend` and `/work/backend` are existing Git checkouts with a commit. Create a new feature branch and linked checkout:

**You / worktree manager**

```bash
git -C /work/backend worktree add -b feature/cross-project /work/backend-feature
```

Before querying either checkout, initialize its CodeGraph index using the native setup command supplied by the maintained example. If you used `--executable` in step 1, replace `codegraph` below with that same absolute executable path:

**You — native backend setup**

```bash
codegraph init /work/frontend --yes
codegraph init /work/backend-feature --yes
```

If you use an authorized automatic preparation recipe, follow step 6 before querying instead. If a checkout already has a current index, follow CodeGraph's update guidance instead. The setup template disables file watching, so synchronize indexes when source changes. If you use another backend, follow its native setup instructions for each checkout.

If `/work/backend-feature` has no local `.1mcprc`, 1MCP can inherit `/work/backend/.1mcprc`. It still queries **the feature worktree's source**. If `.1mcprc` is tracked in Git, the new checkout normally already contains its own copy, which takes precedence.

To customize the worktree, place a complete configuration in `/work/backend-feature/.1mcprc`. Choose **one** server-selection method. For an existing preset named `development`:

```json
{ "preset": "development" }
```

Or, to select servers you have tagged `code`, use this alternative file:

```json
{ "tags": ["code"] }
```

Use your actual preset or tag names. Do not combine `preset` and `tags` in the same configuration. You can omit `.1mcprc` when you need no local override. A local file replaces the inherited file as a whole; omitted fields are not merged. If the local file is invalid, 1MCP logs a warning and ignores its settings without restoring the inherited configuration. Fix the file before relying on its filters or preparation preferences. See [Project checkouts and sets](/guide/project-checkouts) for inheritance details.

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
1mcp inspect codegraph --project /work/backend-feature
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
1mcp instructions --project-set /work/feature-projects.json --project frontend
1mcp inspect codegraph --project-set /work/feature-projects.json --project frontend
1mcp inspect codegraph/codegraph_explore --project-set /work/feature-projects.json --project frontend
1mcp run codegraph/codegraph_explore --project-set /work/feature-projects.json --project frontend --args '{"query":"Where does the frontend call the backend API?"}'
```

Repeat for the backend worktree:

**AI agent**

```bash
# Only if current target instructions were not already delivered:
1mcp instructions --project-set /work/feature-projects.json --project backend
1mcp inspect codegraph --project-set /work/feature-projects.json --project backend
1mcp inspect codegraph/codegraph_explore --project-set /work/feature-projects.json --project backend
1mcp run codegraph/codegraph_explore --project-set /work/feature-projects.json --project backend --args '{"query":"Where are the backend API routes defined?"}'
```

The example requires CodeGraph to expose `codegraph_explore` with a `query` argument. Use the schema returned by your installed server. Confirm that results describe files in the selected checkout and that its index covers current source. A connected server or an index in the main checkout does not establish worktree readiness.

Selecting `--project frontend --project backend` does not broadcast a call or change a global current project. Single-project tools need separate calls, as above. Only a backend with native project-set support can receive both targets in one call. Dynamic templates retain project selectors even during inspection; static, project-independent server/schema inspection does not need a checkout selector.

## 5. Assign workers independently

You or the coordinating AI agent give each worker a concrete assignment in its dispatch prompt. The **worker AI agent** runs the bootstrap command in this example:

> Your Worker Project Assignment is `/work/feature-projects.json`, label `backend` (checkout `/work/backend-feature`). Work only on the backend part of this feature. Use your own verified startup context. Before project-specific discovery, run `1mcp bootstrap --client codex --event SubagentStart --project-set /work/feature-projects.json --project backend`. Bootstrap records this assignment as your default; subsequent calls can omit the project selectors. Inspect the server and tool schema before running tools. Release your own backend binding when your assignment is finished.

For the frontend worker, use label `frontend` and checkout `/work/frontend`. For a worker assigned a direct path, replace `--project-set ... --project backend` with `--project /work/backend-feature`. For Claude Code, use `--client claude` and add the worker’s own `--project-owner <own-file>`.

The explicit bootstrap call resolves the assignment; a parent's cwd or session identity is not an assignment. If startup already delivered the correct assignment and instructions, avoid fetching them again.

Each worker follows step 4 for its own target. With a single assigned target, it can omit project selectors; a worker assigned a project set can select a member with `--project backend`. Concurrent workers keep independent defaults and ownership.

## 6. Prepare a backend when needed

Skip this step if native setup is complete and no preparation recipe is configured. **1MCP does not bundle automatic preparation recipes for CodeGraph, Code Review Graph, or Serena.** If your team supplies one, configure it using [Backend preparation](/guide/backend-preparation), including its supported actions and permissions.

### Inspect, prepare, and retry the tool

The following example assumes that recipe is configured for `codegraph` and covers `codegraph_explore`. Substitute your recipe's configured backend and operation names when different:

**AI agent**

```bash
1mcp project prepare inspect codegraph --operation codegraph_explore --project-set /work/feature-projects.json --project backend
1mcp project prepare start codegraph --operation codegraph_explore --project-set /work/feature-projects.json --project backend
```

Inspection does not start preparation. Start only a permitted action when readiness requires it. If a job ID is returned, replace `JOB_ID` below with that ID:

**AI agent**

```bash
1mcp project prepare wait codegraph JOB_ID --operation codegraph_explore --project-set /work/feature-projects.json --project backend --wait-ms 5000
```

Repeat bounded waits while queued or running. Preserve the same runtime, filters, target, owner, and operation. A finished command is not enough: require verified readiness. On failure, read the reason and deliberately retry only after resolving it. Once ready, repeat server/schema inspection and submit a **fresh** tool call from step 4. Preparation never replays the original request.

## 7. Release and remove the worktree

When a worker finishes its assignment, it releases its own selected binding:

**AI agent — each caller releases its own bindings**

```bash
1mcp project release --project-set /work/feature-projects.json --project backend --format json
```

The frontend worker uses `--project frontend`. The parent also releases every selection it used under its own automatically resolved ownership:

**AI agent — each caller releases its own bindings**

```bash
1mcp project release --project-set /work/feature-projects.json --project frontend --project backend --format json
```

Release protects other owners. A nonzero exit can mean cleanup is still pending; inspect the returned blockers. `SessionEnd` offers bounded session cleanup, but `Stop` and `SubagentStop` are not terminal events. Workers must explicitly release when finished, not after every response.

Before removing `/work/backend-feature`, an authorized local operator closes admission in the **same runtime**:

**Local operator / worktree manager**

```bash
1mcp project drain --project /work/backend-feature --wait-ms 5000 --format json
1mcp project status --project /work/backend-feature --format json
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
1mcp project resume --project /work/backend-feature --format json
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
