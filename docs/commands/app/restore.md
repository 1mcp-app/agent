# app restore

Restores an application to its pre-consolidation state using a backup file.

For a complete overview of the consolidation and restore workflow, see the **[App Consolidation Guide](../../guide/app-consolidation.md)**.

## Synopsis

```bash
1mcp app restore [app-name] [options]
```

## Arguments

- **`[app-name]`**
  - The name of the application to restore. If omitted, you must use `--all` or `--backup`.

## Options

- **`--all`**
  - Restore all applications that have backups.

- **`--backup <path>`**
  - Restore from a specific backup metadata file.

- **`--list, -l`**
  - List available backups for the specified app.

- **`--yes, -y`**
  - Skip the confirmation prompt.

## Examples

```bash
# Restore the latest backup for Claude Desktop
1mcp app restore claude-desktop

# Restore all consolidated applications
1mcp app restore --all

# List available backups for Cursor
1mcp app restore cursor --list
```

## See Also

- **[App Consolidation Guide](../../guide/app-consolidation.md#backup-and-restore-system)**
