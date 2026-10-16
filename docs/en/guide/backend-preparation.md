---
title: Backend Preparation
description: Configure checkout-specific readiness probes and runtime-owned asynchronous preparation commands.
---

# Backend Preparation

The runtime coordinates preparation jobs for a selected Project Checkout. Integrations supply read-only readiness probes and foreground preparation commands. The runtime does not infer readiness from backend names, versions, index files, Git HEAD, connection health, or command output.

## Maintained examples: no handwritten configuration

Install the backend executable first, then select an example in `1mcp mcp install`, or use:

```bash
1mcp mcp install --known codegraph
1mcp mcp install --known code-review-graph
1mcp mcp install --known serena
```

With prerequisites on PATH, selecting an example and accepting defaults needs no JSON, scripts, exit-code mappings, or tool lists. Use `--executable /absolute/path/to/backend` when the installed command is not on PATH. Missing dependencies produce actionable guidance; setup never downloads them or initializes native indexes.

The default is a reusable checkout-bound template, using the checkout selected and authorized by the existing project-context workflow, not the setup command's working directory. Fresh authorized worktrees need no repeated 1MCP configuration, although native initialization/onboarding may still be required. For a fixed target:

```bash
1mcp mcp install --known serena --checkout /absolute/project --name project-serena --dry-run
```

Remove `--dry-run` to save. Equivalent setup is unchanged. Existing overrides, secret references, disables, and preparation restrictions are preserved; meaningful reconfiguration requires `--force`. Static/template name collisions fail rather than silently moving a target. Output distinguishes configuration changes and reload observation from native readiness. Setup grants no additional checkout access.

| Example           | Native prerequisites and next steps                                                                                                                                 | Automatic preparation |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| CodeGraph         | Installed public CLI; native initialization/synchronization for the selected checkout before indexed queries.                                                       | Not enabled by setup  |
| Code Review Graph | Installed public CLI; native build/update for the selected repository before graph queries.                                                                         | Not enabled by setup  |
| Serena            | Installed public CLI and language toolchain/server; native project setup and onboarding when requested. Optional warmup does not block otherwise usable operations. | Not enabled by setup  |

All examples share declarative setup and the normal configuration transaction. No native patches, private database manipulation, or foreign-lock repair is performed. Connectivity does not prove freshness. Ordinary native operations retain their behavior; explicitly readiness-gated operations still require verified evidence. See the [graph diagnostics](/guide/preparation-native-acceptance) and [Serena diagnostics](/guide/preparation-serena-acceptance) for automatic-preparation limitations.

After completing any required native steps, start your configured runtime with `1mcp serve`. In another terminal, select the checkout when inspecting or calling a template:

```bash
1mcp inspect codegraph --project /absolute/project
1mcp inspect code-review-graph --project /absolute/project
1mcp inspect serena --project /absolute/project
```

Read the selected server's instructions and tool schema before invoking an operation. Select a different authorized worktree with `--project /absolute/other-worktree`; do not rerun setup or edit the template. CodeGraph shares one instance for equivalent rendered configurations within a runtime, preventing competing same-checkout writers; distinct checkout paths remain separate. Its example disables watchers, daemon launch, and downloads, so native synchronization is explicit. Serena's example uses its public individual-tools interface and keeps per-client instance isolation. Existing explicit template/environment overrides are preserved and can change these defaults. Literal paths containing environment/template markers are rejected rather than interpreted.

Array-form environment settings are retained verbatim, including inherited global arrays. Setup does not replace them with object-form defaults or materialize secret values. When this prevents adding example environment defaults, setup warns you to review native download/daemon behavior before starting the backend. A fixed/custom binding is not silently converted into a reusable template, even with `--force`.

The setup command does not invoke a dependency installer or native initialization command. If a runtime is already running, normal configuration reload can start a static backend. That backend retains its own startup behavior and may write native state. In particular, install Serena's language dependencies before starting it: native dependency acquisition is not controlled by 1MCP's optional preparation permissions. Missing language dependencies are outside the verified example scope; executable discovery alone does not validate them.

## Verified example scope

On 2026-10-16, the installed backends below passed setup and native-source acceptance on macOS 26.6.2 arm64 with Node.js 26.4.0. These are tested combinations, not a guarantee for other versions, platforms, languages, or repository sizes.

| Example           | Tested version                    | Representative public operation                                        | Result                             |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| CodeGraph         | 1.6.2                             | `codegraph_explore` returns selected-checkout source                   | Template and static targets passed |
| Code Review Graph | 2.3.9                             | `get_minimal_context_tool`, then `get_review_context_tool` with source | Template and static targets passed |
| Serena            | 2.0.0, individual-tools interface | Native instructions/onboarding guidance, then `find_symbol` with body  | Template and static targets passed |

Each backend returned unique source bodies from a main checkout, a linked worktree, and an independent repository. One reusable template configuration served all three, and main was queried again after the other checkouts. Fixtures included spaces, an ampersand, and an apostrophe in their paths. Dry runs, equivalent repeats (including `--force`), and preservation of unrelated configuration/secret references passed. All 21 native source queries passed across 12 isolated runtime lifecycles.

The fixtures contain one TypeScript source file per checkout. Serena used preinstalled TypeScript 5.9.3 and typescript-language-server 5.1.3 copied into an isolated home without downloads. Native initialization was explicit fixture setup: CodeGraph `init`, CRG `build`, and Serena `project create`. Native onboarding guidance was retained, not completed or fabricated by 1MCP. No automatic-preparation freshness, native-writer coordination, cancellation, or large-repository performance support is claimed.

Reproduce from a built source checkout with the named dependencies already installed:

```bash
python3 -B scripts/verify-known-server-setup.py \
  --cli "$PWD/build/index.js" \
  --codegraph /absolute/bin/codegraph \
  --crg /absolute/bin/code-review-graph \
  --serena /absolute/bin/serena \
  --serena-resources /absolute/serena-home
```

The harness writes commands, results, and `evidence.json` to a new OS temporary directory. It uses public 1MCP inspection/invocation and generated configurations, not placeholder substitution or native private APIs. Its cleanup verifies foreground process groups and observed descendants. Arbitrary fast daemonization/reparenting between observations is outside that harness contract; it is not a universal process-containment or runtime-preparation cancellation test.

## Runtime configuration (advanced)

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

## Reusable local definitions (advanced)

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

A definition has `schemaVersion: 1`, a unique `id`, `revision`, `helperRevision`, `compatibility` (backend, versions, platforms, readiness scope), input declarations, `affectedTools`, and an `integration` using the configured-command format above. Use `{input:database}` in argument strings to substitute declared operator inputs literally. Readiness and backend identity still require the configured native probe; compatibility metadata alone is not evidence of readiness.

The definition's identity must match the selected identity. Unsupported schema versions, duplicate built-in identities, local definitions impersonating built-ins, missing or unknown inputs, and conflicting named/inline recipes are errors. Do not combine `definition` with an inline `integration`. Named definitions own their affected-tool list; a configured list must agree exactly.

Runtime `allowedActions` remain separate from definition defaults. A changed definition cannot grant a new action. Effective definition content and recipe revisions participate in preparation identity so incompatible changes cannot reuse old jobs or readiness evidence. Running jobs retain their resolved configuration snapshot. Readiness checks and the final tool dispatch barrier reject a changed effective definition.

Operators maintaining custom helpers must update `helperRevision` when helper behavior changes. Optional `helperFiles` lists at most eight local files totaling 1 MiB whose content hashes also participate in identity. Relative declarations resolve beside the definition file. Declared helper references and canonical helper paths must not contain reserved `{checkout}`, `{operation}`, or `{input:name}` markers. A declared helper used as a whole executable or argv argument is bound to its canonical absolute path, including `helper.cjs` and `./helper.cjs` aliases; a later symlink change cannot redirect that retained command. Embedded references in compound flags or interpreter source strings are unsupported and rejected. The runtime does not parse arbitrary interpreter code. Static declared helper references are bound or rejected before operator input substitution. Operator values remain literal even when they equal or contain helper filenames.

Each retained adapter owns its expected helper digests. It verifies them before launch and before accepting probe, progress, or action completion. Changed or missing declared helpers produce unknown probe readiness or a stable, non-retryable `helper_revision_changed` action failure; they cannot trigger ready capability refresh under the old identity. Resolve the updated definition and explicitly retry. These checks do not freeze external files or provide an atomic executable snapshot. Keep external executables and helper files unchanged while admitted jobs run.

Explicit runtime adoption can set `activation: "setup"` with a named definition, enabling permitted preparation for fresh authorized checkouts without a preparation preference in each project. `enabled: false` at the backend and explicit project disables take precedence. Existing inline configurations retain their project opt-in behavior; upgrades do not set activation automatically.

The built-in preparation-definition registry is empty, independently of the three setup examples above. Automatic preparation requires a separately verified public-interface integration. Local definitions remain an advanced operator-managed interface; setup examples do not resolve the native preparation gaps.

## Project opt-in

Enable automatic preparation by configured server name in the effective `.1mcprc`:

```json
{ "preparation": { "source-search": { "enabled": true } } }
```

For inline commands and named definitions without explicit runtime setup activation, automatic preparation is disabled without this preference. Explicit preparation still obeys runtime action permissions and checkout authorization. Linked worktrees inherit project preferences using whole-file rules; a local configuration replaces the inherited file. See [project checkouts and sets](/guide/project-checkouts).

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

One job performs one action. Successful action exit triggers a fresh probe. Only verified readiness refreshes permitted capabilities, including an initially empty inventory. Another required action finishes as `not_ready`. Explicit retry reprobes and admits that newly required action only when runtime policy permits it, as a separate job retaining the previous terminal record. It does not chain actions automatically. Terminal failures remain observable until explicit retry. Ungated and already-ready unrelated tools remain responsive.

## Budgets and recovery

Runtime defaults are one active expensive job, at most 16 queued jobs, a 120,000 ms execution deadline independent of queue time, and a 5,000 ms request inspection/wait budget. Configure scheduler bounds through the application's `[preparation]` settings. Backend metadata can set `executionDeadlineMs` and `transientRetryLimit`; increasing deadlines requires an explicit runtime configuration change.

Cancellation and execution expiry stop owned action processes and their attached descendants. A direct child exiting does not prove descendants stopped. Restart treats saved state as advisory: the configured read-only probe verifies current readiness and native writer coordination. A native conflict stays blocked until external reconciliation; inspect can then report readiness without starting work, and explicit retry can admit required preparation. No saved PID or flag authorizes signalling, duplicate writers, index deletion, or foreign-lock recovery. Inspection does not erase these facts.

## Real integration acceptance

CodeGraph and Code Review Graph use this same configured-command contract through external wrappers. Repository examples are in `examples/backend-preparation/README.md`, with a bounded native fixture wrapper and `scripts/verify-configured-preparation.mjs` for repeatable acceptance. Code Review Graph status alone does not establish dirty-source freshness; its wrapper must verify that separately or report the coverage gap. Runtime core contains no backend-specific readiness parser. Acceptance evidence must identify backend version, platform, checkout/source size, cold preparation time, warm probe overhead, shared jobs, unrelated ready-tool latency, cancellation coverage, and available CPU/memory observations. Passing local tests does not establish deployment or live client activation.
