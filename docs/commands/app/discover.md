# app discover

Discovers installed desktop applications that have MCP configurations.

This command scans your system for supported applications and reports which ones have detectable MCP server configurations.

For a complete overview of the consolidation workflow, see the **[App Consolidation Guide](../../guide/app-consolidation.md)**.

## Synopsis

```bash
1mcp app discover [options]
```

## Options

- **`--show-empty`**
  - Include supported applications that were found but have no MCP servers configured.

- **`--show-paths`**
  - Display the file paths of the discovered configuration files.

## Examples

```bash
# Discover all installed apps with MCP configurations
1mcp app discover

# Include apps that have config files but no servers
1mcp app discover --show-empty
```

## See Also

- **[App Consolidation Guide](../../guide/app-consolidation.md#the-consolidation-workflow)**
