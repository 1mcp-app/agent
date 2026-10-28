---
title: mcp install
description: Generate backend configuration from a registry entry.
---

# mcp install

Look up a registry entry and write a backend definition to `mcp.json`. Installation here means configuring a launch command or remote endpoint. Package acquisition can happen later when the backend launches; the command does not certify package integrity or resolve a dependency graph itself.

## Syntax

```bash
1mcp mcp install
1mcp mcp install <registry-id> [--dry-run] [--force]
1mcp mcp install <registry-id>@<version>
```

With no ID, or with `--interactive`, the command opens the installation wizard. Use the ID returned by [registry search](/commands/registry/search); example names are not a promise that an entry exists in your selected registry.

## Options

| Option                    | Behavior                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `--interactive, -i`       | Open the installation wizard                                                                   |
| `--dry-run`               | Validate the proposed target without writing it; output shows name/version and registry origin |
| `--force`                 | Replace an existing static server configuration; cannot replace a template                     |
| `--verbose, -v`           | Enable detailed logging                                                                        |
| `--config, -c <path>`     | Select a configuration file                                                                    |
| `--config-dir, -d <path>` | Select a configuration directory                                                               |

For registry connection options, see [Registry commands](/commands/registry/).

## Discover, preview, apply

```bash
1mcp registry search filesystem
1mcp mcp install <registry-id> --dry-run
1mcp mcp install <registry-id>
1mcp mcp list
```

Replace `<registry-id>` with an actual search result before running the install commands. The local name is derived from the registry ID. The dry-run output shows the target name/version and registry origin, not the generated executable, arguments, or URL. Inspect registry metadata with `1mcp registry show <registry-id> --format json`. If you need to review the exact launch configuration before any write, use [mcp add](/commands/mcp/add) with an explicit command or URL instead. After installation, inspect the saved entry in the selected `mcp.json`.

The resolver prefers an npm package when packages are present; otherwise it selects a remote endpoint, preferring Streamable HTTP. Unsupported package types fail rather than being installed by another package manager.

`@<version>` selects registry metadata. It does not itself pin the generated npm package argument to that version: inspect the registry metadata and use an explicitly versioned package with [mcp add](/commands/mcp/add) when you need a package pin.

## Verify readiness

Review the reported configuration and reload result, then use `1mcp inspect` against the intended running runtime. A saved definition does not prove that the backend launched or authenticated. Supply required credentials and server arguments using the backend's documented setup and [configuration reference](/reference/mcp-servers).

`mcp update` edits configuration; it is not a registry package-upgrade command. To replace a registry-derived definition, validate the intended entry and review its registry metadata before using `--force`.

## Related commands

- [mcp setup](/commands/mcp/setup) — Configure an already installed supported backend
- [mcp add](/commands/mcp/add) — Supply an explicit launch command or URL
- [mcp uninstall](/commands/mcp/uninstall) — Remove a definition
- [Server management](/guide/essentials/server-management)
