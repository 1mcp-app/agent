---
title: mcp uninstall
description: Remove a configured backend with an optional configuration backup.
---

# mcp uninstall

Remove a static server or template definition from the selected configuration. This command changes configuration; it does not delete backend packages, repositories, or data.

## Syntax

```bash
1mcp mcp uninstall <server-name> [--force] [--no-backup]
```

`<server-name>` is an existing configured target name, not a registry ID.

## Options

| Option                    | Default                         | Behavior                                                              |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `--config, -c <path>`     | Selected configuration          | Select a configuration file                                           |
| `--config-dir, -d <path>` | Default configuration directory | Select a configuration directory                                      |
| `--backup`                | `true`                          | Require a configuration backup before removal; `--no-backup` skips it |
| `--remove-config`         | `true`                          | Remove the definition; `--no-remove-config` leaves it unchanged       |
| `--force`                 | `false`                         | Override the in-process in-use check                                  |
| `--verbose, -v`           | `false`                         | Enable detailed logging                                               |

The handler does not ask for interactive confirmation. Check the target and selected configuration before invoking it. The in-use check is not a dependency graph or a complete check of activity in another runtime.

## Remove and verify

```bash
1mcp mcp list
1mcp mcp uninstall filesystem
1mcp mcp list
```

On success, the command reports the backup path when created, reload status, and any warnings. A configuration write alone does not prove that the running runtime has applied the removal. Review the reload result and verify the backend is absent from the intended runtime's `1mcp inspect` output.

If removal reports that the target is in use, review active work before using `--force`. Independently hosted remote services remain running; this command removes their 1MCP configuration.

## Restore a backup

Use the exact backup path reported by the command. Review it before restoring the selected configuration file: a full-file restore also reverts other changes made since that backup. Then verify configuration reload and discovery again.

`--no-remove-config` does not uninstall a package or preserve data while removing configuration. It skips removal and prints a warning.

## Related commands

- [mcp install](/commands/mcp/install) — Configure a registry server
- [mcp enable / disable](/commands/mcp/enable-disable) — Keep the definition while disabling it
- [mcp remove](/commands/mcp/remove) — Remove a configured target
- [Server management](/guide/essentials/server-management)
