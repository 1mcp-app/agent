# Command Reference

1MCP Agent provides a comprehensive command-line interface for managing MCP servers and desktop application configurations.

## Quick Reference

### Main Commands

- **`serve`** - Start the 1MCP server (default command)
- **`app`** - Manage desktop application MCP configurations
- **`mcp`** - Manage MCP server configurations

### Global Options

- **`--help, -h`** - Show help information
- **`--version`** - Show version information
- **`--config, -c <path>`** - Specify configuration file path
- **`--transport, -t <type>`** - Transport type (stdio, http, sse)
- **`--port, -P <port>`** - HTTP port (default: 3051)
- **`--host, -H <host>`** - HTTP host (default: localhost)

## Command Groups

### [App Commands](./app/)

Manage desktop application MCP configurations. Consolidate MCP servers from various desktop applications into 1MCP.

```bash
npx -y @1mcp/agent app consolidate claude-desktop    # Consolidate Claude Desktop servers
npx -y @1mcp/agent app restore claude-desktop        # Restore original configuration
npx -y @1mcp/agent app list                          # List supported applications
```

### [MCP Commands](./mcp/)

Manage MCP server configurations within your 1MCP instance.

```bash
npx -y @1mcp/agent mcp add myserver --type=stdio --command=node --args=server.js
npx -y @1mcp/agent mcp list                       # List configured servers
npx -y @1mcp/agent mcp status                     # Check server status
```

### [Serve Command](./serve)

Start the 1MCP server with various configuration options.

```bash
npx -y @1mcp/agent serve                            # Start with default settings
npx -y @1mcp/agent serve --port=3052                # Start on custom port
npx -y @1mcp/agent serve --transport=stdio          # Use stdio transport
```

## Getting Started

If you're new to 1MCP Agent, start with:

1. **[Installation Guide](../guide/installation)** - Install 1MCP Agent
2. **[Quick Start](../guide/quick-start)** - Basic setup and first server
3. **[App Commands](./app/)** - Consolidate existing MCP configurations
4. **[MCP Commands](./mcp/)** - Add and manage MCP servers

## Examples

### Basic Usage

```bash
# Start 1MCP server
npx -y @1mcp/agent serve

# Add a new MCP server
npx -y @1mcp/agent mcp add filesystem --type=stdio --command=mcp-server-filesystem

# Consolidate Claude Desktop configuration
npx -y @1mcp/agent app consolidate claude-desktop

# Check status
npx -y @1mcp/agent mcp status
```

### Advanced Usage

```bash
# Start with custom configuration
npx -y @1mcp/agent serve --config=/custom/path/config.json --port=3052

# Add HTTP-based MCP server
npx -y @1mcp/agent mcp add remote-api --type=http --url=https://api.example.com/mcp

# Bulk consolidate multiple applications
npx -y @1mcp/agent app consolidate claude-desktop cursor vscode --yes

# Filter servers by tags with detailed information
LOG_LEVEL=debug npx -y @1mcp/agent mcp list --tags=prod,api
```

## Environment Variables

All command-line options can also be set via environment variables with the `ONE_MCP_` prefix:

```bash
export ONE_MCP_PORT=3052
export ONE_MCP_HOST=0.0.0.0
export ONE_MCP_CONFIG_PATH=/custom/config.json
```

## Configuration Files

1MCP Agent uses JSON configuration files to store server definitions and settings. See the [Configuration Guide](../guide/essentials/configuration) for detailed information about configuration file formats and options.
