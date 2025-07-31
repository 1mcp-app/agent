# app list

Lists all desktop applications supported by the app consolidation feature.

For a complete list of applications and their status, see the **[App Consolidation Guide](../../guide/app-consolidation.md#supported-applications)**.

## Synopsis

```bash
1mcp app list [options]
```

## Options

- **`--configurable-only`**
  - Show only applications that support automatic consolidation.

- **`--manual-only`**
  - Show only applications that require manual setup.

## Examples

```bash
# List all supported applications
1mcp app list

# List only apps that can be automatically configured
1mcp app list --configurable-only
```

## See Also

- **[App Consolidation Guide](../../guide/app-consolidation.md)**
