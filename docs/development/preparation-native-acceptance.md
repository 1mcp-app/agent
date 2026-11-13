---
title: Graph backend ownership and freshness diagnostics
description: Investigate native graph writes, writer coordination, and dirty-source freshness.
---

# Graph backend ownership and freshness diagnostics

Use this guide when evaluating CodeGraph or Code Review Graph as preparation backends. The [diagnostic script](../../scripts/verify-native-preparation-graphs.py) exercises native APIs in disposable repositories; it does not configure a preparation integration.

## Run the diagnostic

Provide an installed CodeGraph platform bundle containing `node`, `package.json`, and `lib/dist`, and the Python interpreter from a Code Review Graph virtual environment. Preserve the virtualenv interpreter path: resolving its symlink can lose installed packages.

```bash
python3 -B scripts/verify-native-preparation-graphs.py \
  /absolute/path/to/codegraph-platform-bundle \
  /absolute/path/to/crg-virtualenv/bin/python
```

The script uses the supplied installations without downloading dependencies. Its fixture root is hard-coded to `/private/tmp/1mcp-651`; it creates main, linked-worktree, and independent repositories there, disables fixture Git hooks and CodeGraph downloads/telemetry/daemon startup, and retains commands and native-source excerpts in `graphs-native-*/evidence.json`. The latest completed report is `graphs-native-evidence.json` under that root.

The diagnostic was written against CodeGraph 1.6.2 and Code Review Graph 2.3.9. It asserts specific native behaviors, including unsafe ones. Exit zero means those assertions reproduced, not that preparation is safe. With another backend version, inspect failures and its installed source before revising the assertions.

## Interpret the results

| Diagnostic                                                 | Why it matters for an integration                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initialize under a foreign CodeGraph lock                  | Creating the database before acquiring the lock is already a write; exit zero cannot establish safe admission.                                                        |
| Synchronize while a native writer holds a bulk-load window | Opening/healing the database may alter another writer's state before lock acquisition fails.                                                                          |
| Acquire a native lock, then call CodeGraph indexing        | APIs that reacquire the same lock need an explicit ownership handoff; patching private lock methods is not a supported integration.                                   |
| Wrap CRG operations in an outer transaction                | Native metadata commits or file-write rollbacks can end that transaction. SQLite transaction locking does not establish ownership of the whole preparation operation. |
| Add an uncommitted supported file after indexing           | Index-complete status or matching Git commits can coexist with missing source. Verify queries or a complete supported-source scan.                                    |
| Compare state around a warm probe                          | Database sidecars and constructor migrations can make an apparently read-only status call write state.                                                                |

Inspect recorded source hashes and excerpts for the installed version instead of relying on line numbers from an older installation. Keep timing results with the run; tiny fixtures do not establish production-scale probe costs.

## Before using the result in a recipe

Require native ownership before database open, initialization, healing, and writes, and retain it across the full operation. A wrapper-only lock does not coordinate native watchers or CLI writers. Unknown freshness must stay unknown until a supported-source check resolves it.

The diagnostic stops only the lock holders it starts. That cleanup is separate from runtime job cancellation. Follow [integration verification](backend-preparation-acceptance.md) for cancellation, representative performance, and unrelated-tool responsiveness checks.
