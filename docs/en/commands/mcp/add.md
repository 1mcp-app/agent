# mcp add

Adds a new MCP server to the 1MCP configuration.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
# Standard syntax
npx -y @1mcp/agent mcp add <name> --type <type> [options]

# Quick syntax with " -- " pattern (auto-detects type as stdio)
npx -y @1mcp/agent mcp add <name> [options] -- <command> [args...]
```

## Arguments

- **`<name>`**
  - A unique name for the new server.
  - **Required**: Yes

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Command-Specific Options

- **`--type <type>`**
  - The transport type for the server.
  - **Required**: Yes (or auto-detected when using " -- " pattern)
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

- **`--disabled`**
  - Add the server in disabled state. Use `mcp enable <name>` to activate later.

- **`--cwd <path>`**
  - Working directory for `stdio` servers. The process will be started in this directory.

- **`--restart-on-exit`**
  - Enable automatic restart when the process exits (for `stdio` servers only).

- **`--max-restarts <number>`**
  - Maximum number of restart attempts (for `stdio` servers only). If not specified, unlimited restarts are allowed.

- **`--restart-delay <ms>`**
  - Delay in milliseconds between restart attempts (for `stdio` servers only). Default: 1000ms.

## Examples

### Standard Syntax

```bash
# Add a local filesystem server
npx -y @1mcp/agent mcp add files --type=stdio --command="mcp-server-fs" --args="--root,./"

# Add a remote HTTP server with tags
npx -y @1mcp/agent mcp add remote-api --type=http --url="https://api.example.com/mcp" --tags="api,prod"
```

### Quick " -- " Pattern Syntax

```bash
# Add server using " -- " pattern (type auto-detected as stdio)
npx -y @1mcp/agent mcp add airtable --env AIRTABLE_API_KEY=your_key -- npx -y airtable-mcp-server

# Add server with Windows command wrapper
npx -y @1mcp/agent mcp add my-server -- cmd /c npx -y @some/package

# Combine environment variables with " -- " pattern
npx -y @1mcp/agent mcp add context7 --env API_TOKEN=secret --tags=ai,tools -- npx -y @context7/server

# Add server with restart configuration
npx -y @1mcp/agent mcp add robust-server --type=stdio --command=node --args=unstable-server.js --restart-on-exit --max-restarts=5 --restart-delay=2000

# Add disabled server with custom working directory
npx -y @1mcp/agent mcp add dev-server --type=stdio --command=python --args=dev-server.py --cwd=/app/development --disabled
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
