# mcp add

Adds a new MCP server to the 1MCP configuration.

For a complete overview of server management, see the **[Server Management Guide](../../guide/server-management.md)**.

## Synopsis

```bash
1mcp mcp add <name> --type <type> [options]
```

## Arguments

- **`<name>`**
  - A unique name for the new server.
  - **Required**: Yes

## Options

- **`--type <type>`**
  - The transport type for the server.
  - **Required**: Yes
  - **Values**: `stdio`, `http`

- **`--command <command>`**
  - The command to execute for `stdio` servers.
  - **Required for `stdio`**

- **`--args <args>`**
  - Comma-separated list of arguments for the `stdio` command.

- **`--url <url>`**
  - The URL for `http` servers.
  - **Required for `http`**

- **`--tags <tags>`**
  - Comma-separated list of tags for organization.

- **`--env <key=value>`**
  - Environment variables for `stdio` servers. Can be specified multiple times.

- **`--timeout <ms>`**
  - Connection timeout in milliseconds.

## Examples

```bash
# Add a local filesystem server
1mcp mcp add files --type=stdio --command="mcp-server-fs" --args="--root,./"

# Add a remote HTTP server with tags
1mcp mcp add remote-api --type=http --url="https://api.example.com/mcp" --tags="api,prod"
```

## See Also

- **[Server Management Guide](../../guide/server-management.md)**
