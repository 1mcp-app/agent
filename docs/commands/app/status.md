# app status

Shows the current consolidation status of your desktop applications.

This command checks whether an application is configured to connect directly to its own MCP servers or to a central 1MCP instance.

For a complete overview of the consolidation workflow, see the **[App Consolidation Guide](../../guide/app-consolidation.md)**.

## Synopsis

```bash
1mcp app status [app-name] [options]
```

## Arguments

- **`[app-name]`**
  - The application to check. If omitted, it will show the status for all supported apps.

## Options

- **`--verbose, -v`**
  - Show detailed configuration and backup information.

## Examples

```bash
# Show the status of all applications
1mcp app status

# Show the status for a specific app
1mcp app status claude-desktop

# Show detailed status information
1mcp app status --verbose
```

## See Also

- **[App Consolidation Guide](../../guide/app-consolidation.md#the-consolidation-workflow)**
