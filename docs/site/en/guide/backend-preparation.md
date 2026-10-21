---
title: Backend Preparation
description: Understand when a server needs preparation, enable a supplied recipe, and follow preparation progress.
---

# Backend Preparation

For a complete setup-to-cleanup walkthrough, see [Working Across Projects and Worktrees](/guide/worktrees-and-cross-project-sessions).

Examples below use a supported Codex session with verified startup hooks: 1MCP resolves its owner and assigned project automatically. For Claude or hosts without automatic owner lookup, add `--project-owner <own-file>` using that caller’s bootstrap credential; workers use their own. Explicit project selectors below demonstrate overrides for another checkout. See [CLI setup](/commands/cli-setup#session-defaults-and-cleanup) for setup and fallback details.

See the [Prepare command reference](/commands/project/prepare) for syntax, options, audiences, and recovery examples.

Some MCP servers need to initialize a project or update an index before they can answer a request. **Preparation** lets 1MCP run those steps and check whether the server is ready for your selected project.

You only need to configure preparation if you have a recipe for your server. A **recipe** is a JSON file that tells 1MCP how to check readiness and which preparation commands to run. It may be supplied by your team or integration maintainer.

## What is available today?

**1MCP does not currently include automatic preparation recipes for CodeGraph, Code Review Graph, or Serena.** `mcp setup` configures how to launch these servers; their native project setup still needs to be completed separately.

| Server            | What you need to do after setup                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CodeGraph         | Initialize the selected project with CodeGraph and synchronize it when source files change. The setup example disables its file watcher. |
| Code Review Graph | Build the project's graph with Code Review Graph and update it as needed.                                                                |
| Serena            | Install the project's language-server dependencies and follow Serena's project setup and onboarding instructions.                        |

To configure one of these servers, follow [mcp setup](/commands/mcp/setup). You do not need to write a preparation recipe to use it. Once configured, select an authorized project with `--project`; the same server template can be reused across projects, but each project may still need native initialization.

## Use a recipe supplied for your server

If your team or integration maintainer supplies a recipe, save it and any accompanying helper files locally. Follow its instructions for supported backend versions, dependencies, required inputs, and permitted actions. Automatic preparation currently runs on Linux and macOS.

Choose the scope before copying the configuration:

- **All authorized projects using this backend:** retain `activation: "setup"` below. Individual projects can disable preparation.
- **Only selected projects:** omit `activation` and enable preparation in each selected checkout's `.1mcprc`, as shown below.

Add preparation to the existing backend entry under `mcpServers` or `mcpTemplates`. The example below uses a CodeGraph template and a team-supplied recipe; it is not a bundled integration.

Open the `mcp.json` used by your runtime and `mcp setup`. Add `preparation` **inside the existing `mcpTemplates.codegraph` entry**, alongside `command`, `args`, and `cwd`. This complete example shows its placement. Preserve your existing executable, environment, template options, and other servers; do not replace your entire file with this example.

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

Share the recipe and helper files in the layout supplied by the author. Each person keeps their local paths and inputs in `mcp.json`. Existing inline preparation configurations remain supported.

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

The key `codegraph` is the configured server name, not the recipe ID. Add this preference to the checkout's complete effective configuration, preserving its chosen preset **or** tags. A worktree-local `.1mcprc` replaces inherited settings as described in [Project checkouts](/guide/project-checkouts). Invalid local files are ignored without restoring inherited settings; fix them before relying on preparation preferences. Project opt-in does not add allowed actions; an explicit project disable wins over setup-wide activation. To disable preparation for the backend everywhere, set `enabled: false` inside its `preparation` block in `mcp.json`.

## When a tool needs preparation

Call the tool as usual. If it needs preparation, 1MCP returns a job ID instead of running the tool. Wait for the job to become ready, then **call the tool again**. Your original request is not automatically repeated.

If preparation fails or its check cannot confirm readiness, the affected tool stays blocked. Other tools that do not need preparation remain available.

You can also inspect or start preparation yourself. In these examples, replace `source-search` with your configured server name, `lookup` with the tool name covered by the recipe, and `/work/project` with your authorized project path:

```bash
1mcp project prepare inspect source-search --project /work/project --operation lookup
1mcp project prepare source-search --project /work/project --operation lookup
```

`inspect` checks readiness without starting preparation. `prepare` starts a permitted action when needed, including when the server has not yet listed any tools.

Use the returned job ID to follow progress:

```bash
1mcp project prepare wait source-search JOB_ID --project /work/project --wait-ms 5000
```

If the job is still running, wait again. You can also use `prepare status`, `prepare cancel`, or `prepare retry` with the same server name, job ID, and project.

## If preparation cannot finish

| Result                           | What to do                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Ready                            | Submit your tool request again.                                               |
| Queued or running                | Wait for the job, then check its result.                                      |
| Disabled or action not permitted | Review the server's preparation permissions and the project's settings.       |
| Conflict                         | Wait for the other backend operation to finish, then inspect again.           |
| Unknown or unsupported           | Follow the recipe's guidance, or use the backend's native setup instructions. |
| Failed, cancelled, or not ready  | Read the reported reason, resolve it, then explicitly retry if appropriate.   |

A preparation command finishing does not necessarily mean the server is ready: 1MCP checks again before allowing the tool to run. Each job performs one action, so a result may ask you to retry for another step.

For project selection and inherited settings, see [Project checkouts and sets](/guide/project-checkouts). If you are developing a recipe, see the separate [integration author guide](https://github.com/1mcp-app/agent/blob/main/docs/development/backend-preparation-recipes.md).
