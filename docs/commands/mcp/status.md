# mcp status

Checks the status and details of configured MCP servers.

For a complete overview of server management, see the **[Server Management Guide](../../guide/server-management.md)**.

## Synopsis

```bash
1mcp mcp status [name] [options]
```

## Arguments

- **`[name]`**
  - The name of a specific server to check. If omitted, checks all servers.

## Options

- **`--verbose, -v`**
  - Show detailed configuration information.

## Description

This command provides a quick overview of your MCP servers. For `stdio` servers, it checks if the process is running. For `http` servers, it attempts to connect to the health check endpoint.

## Examples

```bash
# Check the status of all servers
1mcp mcp status

# Check the status of a specific server
1mcp mcp status my-server

# Get detailed status information
1mcp mcp status --verbose
```

## See Also

- **[Server Management Guide](../../guide/server-management.md)**
