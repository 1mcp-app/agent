---
title: App Consolidation Guide
description: Consolidate supported desktop MCP configurations into 1MCP and restore them from centralized backups.
head:
  - ['meta', { name: 'keywords', content: '1MCP app consolidation,MCP configuration backup,Claude Desktop,Cursor' }]
  - ['meta', { property: 'og:title', content: '1MCP App Consolidation Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Consolidate supported desktop MCP configurations into 1MCP with dry runs, backups, and restoration.',
      },
    ]
---

# App Consolidation Guide

App consolidation imports an application's configured MCP servers into 1MCP, writes that application's 1MCP connection, and creates a recoverable backup. Start with discovery and a dry run:

```bash
1mcp app discover
1mcp app consolidate claude-desktop --dry-run
1mcp app consolidate claude-desktop
1mcp app status claude-desktop
```

Close the target application before consolidation. Test it after the change, one application at a time.

## Supported Applications

`APP_PRESETS` is the source of truth for `app` commands. Current automatically configurable entries are:

- `claude-desktop`, `cursor`, `vscode`, `claude-code`, `gemini-code`, `augment-code`, `roo-code`, and `cline`.

`cherry-studio` and `continue` are supported through manual instructions from `app consolidate`; they are not edited automatically. GitHub Copilot is not an `APP_PRESETS` target and must not be presented as a supported consolidation path.

Run `1mcp app list` or `1mcp app discover --show-paths` on the target machine to see the available presets and detected locations.

## Backups and Restore

Consolidation stores backups under the global 1MCP configuration root, at `<global-config-dir>/backups/<app-name>/`. With the default global root, this is `~/.config/1mcp/backups/<app-name>/` on macOS and Linux, or `%APPDATA%\1mcp\backups\<app-name>\` on Windows. This location is not changed by `--config-dir`. Existing legacy backups remain discoverable, but new consolidation backups use the centralized location.

```bash
1mcp app backups
1mcp app backups claude-desktop --verify
1mcp app restore claude-desktop
1mcp app restore --all
```

Use `1mcp app backups --cleanup=30` only after confirming that the backups are no longer needed. The command removes backups older than the chosen number of days.

## Troubleshooting

- `app discover` finds no configuration: run the client once, then use `app discover --show-paths` to compare the expected location with the local installation.
- Consolidation cannot write the target: close the client and confirm the current user can write its configuration file.
- The application cannot connect afterwards: start `1mcp serve` and check the default endpoint with `curl http://localhost:3050/health` (or use the configured port).

See [App Commands](/commands/app/) for exact command options.
