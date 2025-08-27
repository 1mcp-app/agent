# mcp list

Lists all configured MCP servers.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
npx -y @1mcp/agent mcp list [options]
```

## Options

- **`--tags <tags>`**
  - Filter the list to only show servers with the specified comma-separated tags.

- **`--show-disabled`**
  - Include disabled servers in the list.

- **`--show-secrets`**
  - Display sensitive information such as command arguments, URLs, and environment variables. By default, sensitive data is redacted for security.

- **`--verbose`**
  - Show detailed information, including headers and environment variables.

## Examples

```bash
# List all enabled servers
npx -y @1mcp/agent mcp list

# List all servers, including disabled ones
npx -y @1mcp/agent mcp list --show-disabled

# List all servers with the "prod" tag
npx -y @1mcp/agent mcp list --tags=prod

# Show detailed information for all servers (verbose mode)
npx -y @1mcp/agent mcp list --verbose

# Show detailed information including sensitive data
npx -y @1mcp/agent mcp list --verbose --show-secrets
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
