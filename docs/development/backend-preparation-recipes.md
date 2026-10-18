---
title: Developing preparation recipes
description: Configured-command recipe contracts and a disposable fixture walkthrough for integration authors.
---

# Developing preparation recipes

For contributors and integration authors. End users should read [Backend preparation](https://docs.1mcp.app/guide/backend-preparation).

## What the fixture demonstrates

`examples/preparation/` is a test backend for the generic recipe mechanism. It compares the bytes of one `source.txt` file with a stored digest, so contributors can reproduce initialization, synchronization, checkout isolation, and pending tool results. It is not a product integration, a code indexer, or a preparation recipe for CodeGraph, Code Review Graph, or Serena. Users do not need to install or run it.

The generator and helper are source-checkout examples, not npm package contents. Real backend recipes need their own verified readiness, ownership, and cancellation behavior; passing this fixture does not establish those guarantees. The runtime E2E coverage lives in `test/e2e/configured-preparation-discovery.test.ts`.

## Fixture configuration

Use this guide when you want to edit and share preparation behavior without rebuilding 1MCP. Keep machine-specific inputs and action permissions in `mcp.json`; reference a local JSON recipe for readiness probes and preparation commands. The same configured-command runtime executes inline commands and referenced recipes. No TypeScript plugin loader is required.

The following configuration uses the **demonstration fixture**, not a CodeGraph, Code Review Graph, or Serena integration. Replace the absolute paths with your repository and Node installation paths. The complete recipe and helper are in [examples/preparation](https://github.com/1mcp-app/agent/tree/main/examples/preparation); they are source-checkout examples, not files bundled in the npm package.

::: v-pre

```json
{
  "mcpServers": {},
  "mcpTemplates": {
    "fixture": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/agent/examples/preparation/fixture.mjs", "serve", "{{{project.path}}}"],
      "cwd": "{{{project.path}}}",
      "preparation": {
        "adapter": "configured-command",
        "definition": {
          "id": "fixture-source",
          "file": "/absolute/agent/examples/preparation/recipe.json",
          "inputs": { "label": "my local environment" }
        },
        "activation": "setup",
        "allowedActions": ["initialize", "sync"]
      }
    }
  }
}
```

:::

The recipe declares available actions; `allowedActions` grants permission to run them. `activation: "setup"` explicitly enables automatic preparation for authorized fresh checkouts without adding a preparation preference to every `.1mcprc`. Backend and project disables still win. Neither copying a recipe nor upgrading 1MCP grants new permissions or checkout access.

Share the recipe and its declared helper files. Each user supplies an absolute recipe path and local inputs in `mcp.json`; retain credentials in the existing secret configuration. Changing an input does not require rebuilding 1MCP. Recipe arguments are literal, not shell commands. Declared helper paths resolve beside the recipe. The fixture invokes `node` from the runtime PATH; change the recipe's executable fields to a local absolute Node path if needed. Executable placeholders are not supported; inputs substitute argument values only.

Use native public CLI commands directly when they provide reliable readiness results. When output needs translation, reference a small external helper through the same executable/argument contract. A helper can be implemented in TypeScript and compiled to JavaScript; it runs as a subprocess, not as a plugin inside 1MCP. A recipe or helper cannot make an unreliable native freshness or ownership check reliable.

## Run the fixture

Requires a source checkout with dependencies installed, Node and Git on PATH, and Linux or macOS. From the 1MCP repository, run:

```bash
pnpm build
node examples/preparation/create-demo.mjs
```

The generator creates two disposable Git checkouts and a `config/mcp.json` under a new temporary directory. It does not modify your project configuration, start a runtime, or install dependencies. Copy the printed `DEMO=...` assignment into both terminals. The fixture's readiness covers **only the exact bytes of `source.txt`**; it is not a native index integration.

In the first terminal, start a separate demo runtime on an unused port:

```bash
node build/index.js serve --config "$DEMO/config/mcp.json" --config-dir "$DEMO/config" --port 3059
```

In the second terminal, inspect and initialize the first checkout:

```bash
node build/index.js preparation inspect fixture --operation source --project "$DEMO/first" --config-dir "$DEMO/config" --url http://localhost:3059/mcp --format json
node build/index.js prepare fixture --operation source --project "$DEMO/first" --config-dir "$DEMO/config" --url http://localhost:3059/mcp --format json
```

The cold fixture initially advertises no tools, so this example uses the preparation control to initialize it. Copy `status.id` from the job response, then wait and query:

```bash
JOB_ID='replace-with-status.id'
node build/index.js preparation wait fixture "$JOB_ID" --wait-ms 5000 --project "$DEMO/first" --config-dir "$DEMO/config" --url http://localhost:3059/mcp --format json
node build/index.js inspect fixture/source --project "$DEMO/first" --config-dir "$DEMO/config" --url http://localhost:3059/mcp
node build/index.js run fixture/source --args '{}' --project "$DEMO/first" --config-dir "$DEMO/config" --url http://localhost:3059/mcp --format json
```

Wait again if the job is still running. A ready query returns `first checkout source`. Repeat the commands with `$DEMO/second`: the same template and recipe prepare an independent snapshot and return `second checkout source`, without either checkout needing `.1mcprc` preparation settings.

Edit `$DEMO/first/source.txt` and call `fixture/source` again. The runtime returns a pending preparation response and runs the permitted `sync` action. Wait for that job and submit a **new** tool request: the original request is not executed or queued for replay. A successful action exit alone never establishes readiness; the probe must verify the updated snapshot.

| Situation                                          | Result                                    |
| -------------------------------------------------- | ----------------------------------------- |
| Snapshot matches `source.txt`                      | Tool runs                                 |
| Snapshot missing                                   | Initialization required                   |
| Source bytes changed                               | Synchronization required                  |
| Fixture writer holds `writer.lock`                 | Conflict; no competing action starts      |
| `unknown.marker` exists                            | Unmapped probe exit; readiness is unknown |
| Required action absent from `allowedActions`       | Action denied                             |
| Backend or project preparation explicitly disabled | No automatic preparation                  |

The fixture uses a shared directory lock only among its own toy writers. Process termination can leave that fixture lock behind; there is no automatic lock repair. Stop the demo runtime before discarding its temporary directory. This demonstration does not establish native backend ownership, cancellation, or freshness support.

## Recipe definition contract (advanced)

A runtime operator can select a reusable JSON definition by its identity and **absolute local file path**. The file is read from that location, independent of the caller's working directory. Project preferences and tool arguments cannot select definitions or introduce executable commands.

```json
{
  "preparation": {
    "adapter": "configured-command",
    "definition": {
      "id": "local-source-search",
      "file": "/opt/1mcp/integrations/source-search.json",
      "inputs": { "database": "/opt/source-search/database" }
    },
    "allowedActions": ["initialize", "sync"]
  }
}
```

A definition has `schemaVersion: 1`, a unique `id`, `revision`, `helperRevision`, `compatibility` (backend, versions, platforms, readiness scope), input declarations, `affectedTools`, and an `integration` using the inline configured-command format below. Use `{input:database}` in argument strings to substitute declared operator inputs literally. Readiness and backend identity still require the configured native probe; compatibility metadata alone is not evidence of readiness.

The definition's identity must match the selected identity. Unsupported schema versions, duplicate built-in identities, local definitions impersonating built-ins, missing or unknown inputs, and conflicting named/inline recipes are errors. Do not combine `definition` with an inline `integration`. Named definitions own their affected-tool list; a configured list must agree exactly.

Runtime `allowedActions` remain separate from definition defaults. A changed definition cannot grant a new action. Effective definition content and recipe revisions participate in preparation identity so incompatible changes cannot reuse old jobs or readiness evidence. Running jobs retain their resolved configuration snapshot. Readiness checks and the final tool dispatch barrier reject a changed effective definition.

Operators maintaining custom helpers must update `helperRevision` when helper behavior changes. Optional `helperFiles` lists at most eight local files totaling 1 MiB whose content hashes also participate in identity. Relative declarations resolve beside the definition file. Declared helper references and canonical helper paths must not contain reserved `{checkout}`, `{operation}`, or `{input:name}` markers. A declared helper used as a whole executable or argv argument is bound to its canonical absolute path, including `helper.cjs` and `./helper.cjs` aliases; a later symlink change cannot redirect that retained command. Embedded references in compound flags or interpreter source strings are unsupported and rejected. The runtime does not parse arbitrary interpreter code. Static declared helper references are bound or rejected before operator input substitution. Operator values remain literal even when they equal or contain helper filenames.

Each retained adapter owns its expected helper digests. It verifies them before launch and before accepting probe, progress, or action completion. Changed or missing declared helpers produce unknown probe readiness or a stable, non-retryable `helper_revision_changed` action failure; they cannot trigger ready capability refresh under the old identity. Resolve the updated definition and explicitly retry. These checks do not freeze external files or provide an atomic executable snapshot. Keep external executables and helper files unchanged while admitted jobs run.

Explicit runtime adoption can set `activation: "setup"` with a named definition, enabling permitted preparation for fresh authorized checkouts without a preparation preference in each project. `enabled: false` at the backend and explicit project disables take precedence. Existing inline configurations retain their project opt-in behavior; upgrades do not set activation automatically.

The built-in preparation-definition registry is empty, independently of the three setup examples above. Automatic preparation requires a separately verified public-interface integration. Local definitions remain an advanced operator-managed interface; setup examples do not resolve the native preparation gaps.

## Inline commands (advanced)

Add preparation metadata to an existing server definition. Use executable paths and argument arrays; arguments are passed literally without shell parsing. `{checkout}` and `{operation}` are replaced in arguments, and the command runs in the selected canonical checkout. Commands belong to the runtime configuration, never project preferences or caller arguments.

```json
{
  "preparation": {
    "adapter": "configured-command",
    "affectedTools": ["lookup"],
    "allowedActions": ["initialize", "sync"],
    "integration": {
      "probe": {
        "executable": "/absolute/path/to/readiness-wrapper",
        "args": ["{checkout}", "{operation}"]
      },
      "readinessExitCodes": {
        "0": { "state": "ready" },
        "2": { "state": "required", "action": "initialize", "instructions": "Initialize the selected checkout." },
        "3": { "state": "required", "action": "sync", "instructions": "Synchronize changed source." },
        "4": { "state": "conflict", "instructions": "Reconcile the existing writer before retrying." }
      },
      "actions": {
        "initialize": {
          "executable": "/absolute/path/to/prepare-wrapper",
          "args": ["initialize", "{checkout}", "{operation}"]
        },
        "sync": { "executable": "/absolute/path/to/prepare-wrapper", "args": ["sync", "{checkout}", "{operation}"] }
      },
      "containment": "posix-process-group"
    }
  }
}
```

Replace these example wrapper paths with installed integration scripts. A probe must establish freshness and coverage for this checkout and operation, including dirty source. Unmapped exits and timeouts produce unknown readiness; logs are bounded diagnostics. An integration that cannot establish freshness should report unknown rather than ready. `affectedTools` accepts explicit upstream names or `"all"`; other tools retain their ordinary behavior. A gated backend with no integration reports unsupported preparation.

Each action may explicitly define `successExitCodes` (default `[0]`) and `transientExitCodes`. The mappings must not overlap. Only explicitly transient failures can retry automatically, within `transientRetryLimit` and the job deadline. `allowedActions` grants runtime authority. Rebuilds, dependency installation, and paid services require explicit `rebuild`, `install`, or `paid` permission; project preferences cannot add them.

An optional `status` command uses the same executable/args format and returns exit zero with a JSON object containing optional `message`, `completed`, `total`, and `unit`. Explicit inspection validates this progress; absent progress remains unavailable. Logs never supply inferred percentages. Probe/status commands must be read-only and bounded. `inspectionTimeoutMs` defaults to 5,000; `outputLimitBytes` defaults to 16,384.

Preparation commands must stay in the runtime-owned process group and keep descendants attached. The current containment implementation supports Linux and macOS. Unsupported platforms reject preparation before launching an action. Declaring containment is an operator assertion about integration scripts; escaping or detached writers are outside this contract. Native writer coordination remains the integration's responsibility. The runtime never kills foreign work or breaks another writer's lock.

## Project opt-in

Enable automatic preparation by configured server name in the effective `.1mcprc`:

```json
{ "preparation": { "source-search": { "enabled": true } } }
```

For inline commands and named definitions without explicit runtime setup activation, automatic preparation is disabled without this preference. Explicit preparation still obeys runtime action permissions and checkout authorization. Linked worktrees inherit project preferences using whole-file rules; a local configuration replaces the inherited file. See [project checkouts and sets](https://docs.1mcp.app/guide/project-checkouts).

## Controls and asynchronous admission

Preparation controls remain accessible even if initial tool discovery is empty:

```bash
1mcp prepare inspect source-search --project /work/frontend --operation lookup --format json
1mcp prepare source-search --project /work/frontend --operation lookup --format json
OPERATION_ID='replace-with-returned-job-id'
1mcp prepare status source-search "$OPERATION_ID" --project /work/frontend
1mcp prepare wait source-search "$OPERATION_ID" --project /work/frontend --wait-ms 5000
1mcp prepare cancel source-search "$OPERATION_ID" --project /work/frontend
1mcp prepare retry source-search "$OPERATION_ID" --project /work/frontend
```

`inspect` reads readiness and current job state, action, elapsed time, and available progress. It does not schedule preparation, repair state, or retry failed jobs. Handles are bound to the authenticated owner, target, operation, and effective configuration. Controls using an ID recover its operation automatically; an explicitly conflicting operation is rejected.

A gated cold tool call promptly returns a job ID and state. **The original operation is neither executed nor queued for replay**, even if preparation completes quickly. Submit a fresh tool request after readiness is verified. Compatible callers share a job; different checkouts, operations, and policies do not. Caller disconnects leave shared work running.

One job performs one action. Successful action exit triggers a fresh probe. Only verified readiness refreshes permitted capabilities, including an initially empty inventory. Another required action finishes as `not_ready`. Explicit retry reprobes and admits that newly required action only when runtime policy permits it, as a separate job retaining the previous terminal record. It does not chain actions automatically. Terminal failures remain observable until explicit retry. Ungated and already-ready unrelated tools remain responsive.

## Budgets and recovery

Runtime defaults are one active expensive job, at most 16 queued jobs, a 120,000 ms execution deadline independent of queue time, and a 5,000 ms request inspection/wait budget. Configure scheduler bounds through the application's `[preparation]` settings. Backend metadata can set `executionDeadlineMs` and `transientRetryLimit`; increasing deadlines requires an explicit runtime configuration change.

Cancellation and execution expiry stop owned action processes and their attached descendants. A direct child exiting does not prove descendants stopped. Restart treats saved state as advisory: the configured read-only probe verifies current readiness and native writer coordination. A native conflict stays blocked until external reconciliation; inspect can then report readiness without starting work, and explicit retry can admit required preparation. No saved PID or flag authorizes signalling, duplicate writers, index deletion, or foreign-lock recovery. Inspection does not erase these facts.
