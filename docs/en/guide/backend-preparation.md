---
title: Backend Preparation
description: Configure checkout-specific readiness probes and runtime-owned asynchronous preparation commands.
---

# Backend Preparation

The runtime coordinates preparation jobs for a selected Project Checkout. Integrations supply read-only readiness probes and foreground preparation commands. The runtime does not infer readiness from backend names, versions, index files, Git HEAD, connection health, or command output.

## Runtime configuration

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

Automatic preparation is disabled without this preference. Explicit preparation still obeys runtime action permissions and checkout authorization. Linked worktrees inherit project preferences using whole-file rules; a local configuration replaces the inherited file. See [project checkouts and sets](/guide/project-checkouts).

## Controls and asynchronous admission

Preparation controls remain accessible even if initial tool discovery is empty:

```bash
1mcp preparation inspect source-search --project /work/frontend --operation lookup --format json
1mcp prepare source-search --project /work/frontend --operation lookup --format json
OPERATION_ID='replace-with-returned-job-id'
1mcp preparation status source-search "$OPERATION_ID" --project /work/frontend
1mcp preparation wait source-search "$OPERATION_ID" --project /work/frontend --wait-ms 5000
1mcp preparation cancel source-search "$OPERATION_ID" --project /work/frontend
1mcp preparation retry source-search "$OPERATION_ID" --project /work/frontend
```

`inspect` reads readiness and current job state, action, elapsed time, and available progress. It does not schedule preparation, repair state, or retry failed jobs. Handles are bound to the authenticated owner, target, operation, and effective configuration. Controls using an ID recover its operation automatically; an explicitly conflicting operation is rejected.

A gated cold tool call promptly returns a job ID and state. **The original operation is neither executed nor queued for replay**, even if preparation completes quickly. Submit a fresh tool request after readiness is verified. Compatible callers share a job; different checkouts, operations, and policies do not. Caller disconnects leave shared work running.

One job performs one action. Successful action exit triggers a fresh probe. Only verified readiness refreshes permitted capabilities, including an initially empty inventory. Another required action finishes as `not_ready`; it needs explicit retry rather than automatic action chaining. Terminal failures remain observable until explicit retry. Ungated and already-ready unrelated tools remain responsive.

## Budgets and recovery

Runtime defaults are one active expensive job, at most 16 queued jobs, a 120,000 ms execution deadline independent of queue time, and a 5,000 ms request inspection/wait budget. Configure scheduler bounds through the application's `[preparation]` settings. Backend metadata can set `executionDeadlineMs` and `transientRetryLimit`; increasing deadlines requires an explicit runtime configuration change.

Cancellation and execution expiry stop owned action processes and their attached descendants. A direct child exiting does not prove descendants stopped. Restart treats saved state as advisory: integrations reprobe readiness, and uncertain formerly running ownership reports conflict. No saved PID or flag authorizes signalling, duplicate writers, index deletion, or foreign-lock recovery. Inspection does not erase these facts.

## Real integration acceptance

CodeGraph and Code Review Graph use this same configured-command contract through external wrappers. Repository examples are in `examples/backend-preparation/README.md`, with a bounded native fixture wrapper and `scripts/verify-configured-preparation.mjs` for repeatable acceptance. Code Review Graph status alone does not establish dirty-source freshness; its wrapper must verify that separately or report the coverage gap. Runtime core contains no backend-specific readiness parser. Acceptance evidence must identify backend version, platform, checkout/source size, cold preparation time, warm probe overhead, shared jobs, unrelated ready-tool latency, cancellation coverage, and available CPU/memory observations. Passing local tests does not establish deployment or live client activation.
