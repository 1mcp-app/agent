# app list

Lists all desktop applications supported by the app consolidation feature.

For a complete list of applications and their status, see the **[App Consolidation Guide](../../guide/integrations/app-consolidation#supported-applications)**.

## Synopsis

```bash
npx -y @1mcp/agent app list [options]
```

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--configurable-only`**
  - Show only applications that support automatic consolidation.

- **`--manual-only`**
  - Show only applications that require manual setup.

## Examples

```bash
# List all supported applications
npx -y @1mcp/agent app list

# List only apps that can be automatically configured
npx -y @1mcp/agent app list --configurable-only
```

## See Also

- **[App Consolidation Guide](../../guide/integrations/app-consolidation)**
