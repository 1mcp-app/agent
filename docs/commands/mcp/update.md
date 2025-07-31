# mcp update

Updates the configuration of an existing MCP server.

For a complete overview of server management, see the **[Server Management Guide](../../guide/server-management.md)**.

## Synopsis

```bash
1mcp mcp update <name> [options]
```

## Arguments

- **`<name>`**
  - The name of the server to update.
  - **Required**: Yes

## Options

- **`--tags <tags>`**
  - A new comma-separated list of tags. This will overwrite the existing tags.

- **`--env <key=value>`**
  - Add or update an environment variable. Can be specified multiple times.

- **`--timeout <ms>`**
  - A new connection timeout in milliseconds.

- **`--command <command>`**, **`--args <args>`**, **`--url <url>`**
  - You can also update the core properties of the server.

## Examples

```bash
# Update the tags for a server
1mcp mcp update my-server --tags="new-tag,another-tag"

# Update an environment variable
1mcp mcp update my-stdio-server --env="NODE_ENV=production"

# Change the URL of an HTTP server
1mcp mcp update my-http-server --url="https://new.api.com/mcp"
```

## See Also

- **[Server Management Guide](../../guide/server-management.md)**
