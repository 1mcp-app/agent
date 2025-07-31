# mcp remove

Removes an MCP server from the 1MCP configuration.

For a complete overview of server management, see the **[Server Management Guide](../../guide/server-management.md)**.

## Synopsis

```bash
1mcp mcp remove <name> [options]
```

## Arguments

- **`<name>`**
  - The name of the server to remove.
  - **Required**: Yes

## Options

- **`--yes, -y`**
  - Skip the confirmation prompt.

## Examples

```bash
# Remove a server
1mcp mcp remove my-server

# Remove a server without prompting for confirmation
1mcp mcp remove old-server --yes
```

## See Also

- **[Server Management Guide](../../guide/server-management.md)**
