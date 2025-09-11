# mcp status

Checks the status and details of configured MCP servers.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
npx -y @1mcp/agent mcp status [name] [options]
```

## Arguments

- **`[name]`**
  - The name of a specific server to check. If omitted, checks all servers.

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--verbose`**
  - Show detailed configuration information.

## Description

This command provides a quick overview of your MCP servers. For `stdio` servers, it checks if the process is running. For `http` servers, it attempts to connect to the health check endpoint.

## Examples

```bash
# Check the status of all servers
npx -y @1mcp/agent mcp status

# Check the status of a specific server
npx -y @1mcp/agent mcp status my-server

# Get detailed status information
npx -y @1mcp/agent mcp status --verbose
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
