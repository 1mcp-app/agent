# server list

Lists all configured MCP servers.

For a complete overview of server management, see the **[Server Management Guide](../../guide/server-management.md)**.

## Synopsis

```bash
1mcp server list [options]
```

## Options

- **`--tags <tags>`**
  - Filter the list to only show servers with the specified comma-separated tags.

- **`--show-disabled`**
  - Include disabled servers in the list.

- **`--verbose, -v`**
  - Show detailed information, including command/URL, arguments, and environment variables.

## Examples

```bash
# List all enabled servers
1mcp server list

# List all servers, including disabled ones
1mcp server list --show-disabled

# List all servers with the "prod" tag
1mcp server list --tags=prod

# Show detailed information for all servers
1mcp server list --verbose
```

## See Also

- **[Server Management Guide](../../guide/server-management.md)**
