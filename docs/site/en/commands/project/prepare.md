---
title: Project Prepare Command - Backend Readiness and Preparation Jobs
description: Inspect checkout-specific backend readiness, request authorized preparation, and monitor, cancel, or retry asynchronous jobs with 1MCP.
head:
  - [
      'meta',
      { name: 'keywords', content: '1MCP project prepare,preparation,backend readiness,job status,agent bootstrap' },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Project Prepare Command Reference' }]
  - [
      'meta',
      { property: 'og:description', content: 'Check backend readiness and manage runtime-owned preparation jobs.' },
    ]
---

# Project Prepare Command

For caller release, checkout drain, status and resume, see [Project lifecycle](/commands/project/). Supported Codex sessions use their verified owner and assigned project automatically. Other hosts retain their own bootstrap `--project-owner` reference on preparation and subsequent tool calls. Per-call target overrides must stay consistent through preparation and the fresh tool call.

Make a configured backend ready for a selected checkout and operation, for example by initializing an index or synchronizing changed source. Preparation uses integration commands and action permissions configured by the runtime operator. It requires a runtime with the HTTP preparation endpoint; there is no upstream MCP fallback.

## Who uses it?

- **Humans/operators** configure integrations, allowed actions, and automatic preparation preferences, and investigate failures.
- **Agents** inspect readiness, request work within existing authorization, monitor jobs, and resume tool usage after verified readiness. They must not widen permissions or enable automatic preparation to bypass a block.

[CLI setup](/commands/cli-setup) installs guidance delivered by `bootstrap` hooks. Installing guidance does not run preparation or change permissions. See [Backend Preparation](/guide/backend-preparation) for configuration and integration requirements.

## Synopsis

```bash
1mcp project prepare <backend> [options]
1mcp project prepare start <backend> [options]
1mcp project prepare inspect <backend> [options]
1mcp project prepare status <backend> [id] [options]
1mcp project prepare wait <backend> <id> [options]
1mcp project prepare cancel <backend> <id> [options]
1mcp project prepare retry <backend> [id] [options]
```

`backend` is the configured server name, not an executable or tool reference. `project prepare <backend>` is shorthand for `project prepare start <backend>`. Use explicit `start` for names matching subcommands, such as `1mcp project prepare start status`.

## Actions

| Action                 | Behavior                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start` (or shorthand) | Probe readiness and request permitted work when needed; return readiness or an asynchronous job.                                                     |
| `inspect`              | Read readiness and available job/progress information without scheduling work or retrying failures. Works even when initial tool discovery is empty. |
| `status`               | Read a job by ID, or resolve the current state for the selected target and operation when ID is omitted.                                             |
| `wait`                 | Wait for a bounded interval on the given job. A returned running state means preparation is still pending.                                           |
| `cancel`               | Request cancellation of the runtime-owned job and attached processes. Compatible callers may share the job.                                          |
| `retry`                | Explicitly retry after a readiness probe, subject to runtime permissions. Omit ID to resolve the selected target/operation's retained job.           |

`start` and `inspect` do not accept IDs. `wait` and `cancel` require the returned job ID. IDs are bound to owner, target, operation, and effective configuration. ID-based controls recover the operation automatically; a conflicting explicit `--operation` is rejected.

## Options

| Option                                                          | Meaning                                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--project <path-or-label>`                                     | Absolute checkout path, or member label with a project set. Select one checkout for checkout-specific work.                        |
| `--project-set <path>`                                          | Saved project-set definition; use `--project <label>` to select the checkout.                                                      |
| `--project-owner <file>`                                        | Retain the private credential supplied by this local caller’s bootstrap.                                                           |
| `--operation <name>`                                            | Operation-specific readiness, usually the upstream tool name. Preserve it from inspection/start; ID-based controls can recover it. |
| `--url <url>`                                                   | Override the detected runtime URL.                                                                                                 |
| `--context <name>`                                              | Attach using a named runtime target context.                                                                                       |
| `--preset <name>`, `--tags <tags>`, `--tag-filter <expression>` | Existing runtime filters; preserve the same selection throughout the workflow.                                                     |
| `--format <text\|json>`                                         | Output format; defaults to `text`. Agents can use `json` for structured states and job IDs.                                        |
| `--wait-ms <milliseconds>`                                      | Only for `wait`; integer from 0 to 3,600,000. Omission uses the runtime default. This does not extend the job execution deadline.  |

Global configuration options also apply. Use `1mcp project prepare --help` and subcommand help to see available flags. Keep the same runtime, filters, checkout, and operation across controls and subsequent tool calls.

Retain `--project-owner <file>` with the private credential supplied by this local caller’s bootstrap. Replace `/private/session-owner.json` below with that path; workers use their own credentials. See [Project and owner options](/guide/project-checkouts#project-and-owner-options).

## Example: inspect, prepare, and resume

Assume an operator has configured `source-search` with a permitted preparation action for `lookup`:

```bash
1mcp project prepare inspect source-search --project /work/frontend --operation lookup --format json --project-owner /private/session-owner.json
1mcp project prepare start source-search --project /work/frontend --operation lookup --format json --project-owner /private/session-owner.json
# If the response contains a job, copy its status.id:
JOB_ID='replace-with-returned-job-id'
1mcp project prepare wait source-search "$JOB_ID" --project /work/frontend --wait-ms 5000 --format json --project-owner /private/session-owner.json
1mcp project prepare status source-search "$JOB_ID" --project /work/frontend --format json --project-owner /private/session-owner.json
```

If start reports `ready`, there is no job to wait for. Otherwise inspect the returned state, waiting again only while work is pending and within the task's budget. After readiness is verified:

```bash
1mcp inspect source-search --project /work/frontend --project-owner /private/session-owner.json
1mcp inspect source-search/lookup --project /work/frontend --project-owner /private/session-owner.json
# Supply arguments matching the freshly inspected schema:
1mcp run source-search/lookup --project /work/frontend --args '{"query":"example"}' --project-owner /private/session-owner.json
```

**Preparation never executes or replays the original tool call.** A tool call that triggers automatic preparation also requires a fresh invocation after readiness. Preserve additional runtime/filter flags if used in your session.

## States and recovery

- `queued`, `running`, or `cancelling`: observe the existing job; do not start duplicate work.
- `ready`: the readiness probe verified the backend; refresh discovery and invoke the tool afresh.
- `not_ready`: the action finished but the probe still requires work. An explicit authorized `retry` may create a separate job for the next required action; actions do not chain automatically.
- `failed` or `cancelled`: inspect diagnostics and deliberately recover or stop. Do not loop on retry automatically.
- `unknown`, `unsupported`, `conflict`, `forbidden`, `disabled`, or `busy`: follow the returned instructions and report the blocker. Do not infer readiness, break foreign locks, or change permissions to force progress.

```bash
1mcp project prepare retry source-search "$JOB_ID" --project /work/frontend --format json --project-owner /private/session-owner.json
1mcp project prepare cancel source-search "$JOB_ID" --project /work/frontend --format json --project-owner /private/session-owner.json
```

These are alternative recovery actions, not a sequence to execute routinely. Read-only inspection never starts preparation. Command success alone does not prove backend readiness; the response state and probe evidence determine the next step. Preparation requires a configured integration, and process containment currently supports Linux and macOS.
