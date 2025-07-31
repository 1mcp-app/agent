# Command Reference

1MCP Agent provides a comprehensive command-line interface for managing MCP servers and desktop application configurations.

## Quick Reference

### Main Commands

- **`serve`** - Start the 1MCP server (default command)
- **`app`** - Manage desktop application MCP configurations
- **`server`** - Manage MCP server configurations

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
1mcp app consolidate claude-desktop    # Consolidate Claude Desktop servers
1mcp app restore claude-desktop        # Restore original configuration
1mcp app list                          # List supported applications
```

### [Server Commands](./server/)

Manage MCP server configurations within your 1MCP instance.

```bash
1mcp server add myserver --type=stdio --command=node --args=server.js
1mcp server list                       # List configured servers
1mcp server status                     # Check server status
```

### [Serve Command](./serve/)

Start the 1MCP server with various configuration options.

```bash
1mcp serve                            # Start with default settings
1mcp serve --port=3052                # Start on custom port
1mcp serve --transport=stdio          # Use stdio transport
```

## Getting Started

If you're new to 1MCP Agent, start with:

1. **[Installation Guide](../guide/installation.md)** - Install 1MCP Agent
2. **[Quick Start](../guide/quick-start.md)** - Basic setup and first server
3. **[App Commands](./app/)** - Consolidate existing MCP configurations
4. **[Server Commands](./server/)** - Add and manage MCP servers

## Examples

### Basic Usage

```bash
# Start 1MCP server
1mcp serve

# Add a new MCP server
1mcp server add filesystem --type=stdio --command=mcp-server-filesystem

# Consolidate Claude Desktop configuration
1mcp app consolidate claude-desktop

# Check status
1mcp server status
```

### Advanced Usage

```bash
# Start with custom configuration
1mcp serve --config=/custom/path/config.json --port=3052

# Add HTTP-based MCP server
1mcp server add remote-api --type=http --url=https://api.example.com/mcp

# Bulk consolidate multiple applications
1mcp app consolidate claude-desktop cursor vscode --yes

# Filter servers by tags
1mcp server list --tags=prod,api --verbose
```

## Environment Variables

All command-line options can also be set via environment variables with the `ONE_MCP_` prefix:

```bash
export ONE_MCP_PORT=3052
export ONE_MCP_HOST=0.0.0.0
export ONE_MCP_CONFIG_PATH=/custom/config.json
```

## Configuration Files

1MCP Agent uses JSON configuration files to store server definitions and settings. See the [Configuration Guide](../guide/configuration.md) for detailed information about configuration file formats and options.
