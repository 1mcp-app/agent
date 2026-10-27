---
title: CLI and Admin adoption measurements
description: Closed command families and runtime-owned Admin feature outcomes in Product Usage Telemetry.
---

# CLI and Admin adoption measurements

Use this reference to interpret aggregate command and Admin feature counters. Collection follows the local [telemetry controls](/commands/telemetry); it never exports arguments, configured names, request payloads, routes, credentials, diagnostic context, or raw errors.

## Command coverage

Each valid registered short-command handler records one outcome on completion. A returned or terminal zero exit status is success; a rejection or nonzero status is failure. Nested handler delegation and owned implementation-child CLI launches record only the outer invocation. An observed termination signal during an active short command records failure while preserving the existing signal owner. Parser errors, unknown commands, help, version, and all `telemetry status|enable|disable|reset` controls are excluded.

The receiver has a fixed family catalog. Grouped roots share one aggregate and cannot be distinguished in reports:

| Registered root                          | Registered handlers                                                                                                                           | Report family |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Default invocation, `serve`              | Start/background/restart at startup readiness; `--status` and `--stop` at control completion                                                  | `serve`       |
| `proxy`                                  | Startup readiness or startup failure                                                                                                          | `proxy`       |
| `mcp`                                    | add, setup, install, remove, uninstall, update, enable, disable, restart, list, status, tokens, search; tools interactive/list/enable/disable | `mcp`         |
| `registry`                               | search, status, show, versions                                                                                                                | `mcp`         |
| `preset`                                 | Interactive root; edit, create, show, list, url, delete, test                                                                                 | `preset`      |
| `project`                                | release, drain, status, resume, recover; prepare default/start/inspect/status/wait/cancel/retry                                               | `project`     |
| `bootstrap`                              | Agent hook delivery                                                                                                                           | `project`     |
| `auth`                                   | login, status, logout, export-oauth-credentials, export-upstream-credentials                                                                  | `auth`        |
| `admin`                                  | bootstrap, login, status, logout                                                                                                              | `auth`        |
| `app`                                    | consolidate, restore, list, discover, status, backups                                                                                         | `config`      |
| `cli-setup`                              | Shell setup                                                                                                                                   | `config`      |
| `target`                                 | add, use, export, import, doctor, current, list, inspect, delete, rename, verify                                                              | `config`      |
| `instructions`, `inspect`, `run`, `wait` | Each root handler                                                                                                                             | Same as root  |
| `telemetry`                              | status, enable, disable, reset                                                                                                                | Excluded      |

`project prepare` is nested under `project`; there is no separately registered root `prepare` command. Starting or restarting a runtime retains startup-only measurement: shutdown does not add a command outcome. Automatic supervised runtime starts use the separate `runtime_start` feature.

Command success describes the command's established exit semantics. For example, an interactive cancellation that intentionally exits zero remains a successful command outcome; it does not imply that configuration changed.

## Admin feature coverage

The Aggregated Runtime records approved mutations at the shared Admin Operation owner, whether invoked through the browser or CLI Admin Adapter. The CLI process may also record its command family; this does not create another feature or MCP operation counter. Remote actions belong to the selected remote runtime and its collection policy.

| Runtime action                                                        | Feature                            |
| --------------------------------------------------------------------- | ---------------------------------- |
| Successful browser Admin Session login                                | `admin_open`                       |
| Configured server create                                              | `server_add`                       |
| Configured server edit                                                | `server_update`                    |
| Configured server delete                                              | `server_remove`                    |
| Configured server enable/disable, including confirmed lifecycle apply | `server_enable` / `server_disable` |
| Preset create/update/duplicate/delete                                 | `preset_update`                    |
| Instruction template create/update/clone/activate/import/delete       | `template_update`                  |

`admin_open` means successful browser authentication, not every page, asset, session read, or CLI login. Reopening with an existing session adds no open counter. Failed login adds none.

Mutation outcomes describe the shared operation's completed or failed result. Idempotent replays, rejected admission or confirmation, previews, validation, reads, and dry runs add none. The action's configuration/reload details remain local; a completed persisted mutation does not establish backend readiness. Unsupported actions, including backend restart, OAuth authorization/restart and credential management, are excluded instead of being labelled as unrelated features. The receiver's `config_update` label currently has no generic Admin configuration action owner in this surface. Unknown feature names fail closed; there is no feature `other`.

## Delivery and interpretation limits

All facts remain best effort. Forceful OS termination can bypass JavaScript completion hooks entirely. Immediate terminal exits emit the coarse completion before exiting, but asynchronous admission or persistence may not finish; final short-command facts can be lost. The command does not wait for a queue, flush, or collector. Ordinary returning commands also do not await delivery. Reset/disable and bounded storage can discard facts. Counters are observations, not durable audit records or exact counts of configuration changes.

Reports remain private and aggregate-only, with human and CI activity segmented. This implementation does not establish deployed collector compatibility, dashboard access, or production activation; those require separate receiver and deployment evidence.
