---
title: Backend Preparation
description: Understand when a server needs preparation, enable a supplied recipe, and follow preparation progress.
---

# Backend Preparation

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

Add a `preparation` section to the server's existing entry in `mcp.json`, under `mcpServers` or `mcpTemplates`. The example below shows the configuration shape: **`team-source-search` and its file path are placeholders, not a bundled recipe**. Replace them with the ID and absolute path supplied with your recipe.

```json
{
  "preparation": {
    "adapter": "configured-command",
    "definition": {
      "id": "team-source-search",
      "file": "/absolute/path/to/source-search.json"
    },
    "activation": "setup",
    "allowedActions": ["initialize", "sync"]
  }
}
```

| Setting               | What to provide                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `definition.id`       | The ID declared by the recipe.                                                                                          |
| `definition.file`     | The absolute path to the recipe on this machine.                                                                        |
| `definition.inputs`   | Add this object only if the recipe needs local values, using the input names it documents.                              |
| `activation: "setup"` | Enable automatic preparation for authorized projects using this server, without enabling it separately in each project. |
| `allowedActions`      | The actions you permit. Include `initialize` and `sync` only if the recipe supports them and you want them to run.      |

Share the recipe and its accompanying files with teammates. Each person keeps their own file paths and inputs in `mcp.json`. Updating a recipe does not grant permission to run additional actions. Existing inline preparation configurations continue to work; there is no need to convert them.

To turn automatic preparation off for one project, add the following to its effective `.1mcprc`, replacing `source-search` with the **configured server name** from `mcp.json`:

```json
{ "preparation": { "source-search": { "enabled": false } } }
```

An explicit project disable takes precedence over `activation: "setup"`. To disable preparation for the server as a whole, set `enabled: false` inside its `preparation` section in `mcp.json`.

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
