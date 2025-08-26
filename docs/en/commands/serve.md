# Serve Command

Start the 1MCP server with various transport and configuration options.

## Synopsis

```bash
npx -y @1mcp/agent [serve] [options]
npx -y @1mcp/agent [options]  # serve is the default command
```

## Description

The `serve` command starts the 1MCP server, which acts as a unified proxy/multiplexer for multiple MCP servers. It can operate in different transport modes and provides a unified interface for MCP clients.

For a complete list of command-line flags, environment variables, and JSON configuration options, please see the \*\*[Configuration Deep Dive](../guide/essentials/configuration.md)

## Examples

### Basic Usage

```bash
# Start with default settings (HTTP on localhost:3051)
npx -y @1mcp/agent serve

# Start on custom port
npx -y @1mcp/agent serve --port=3052

# Start with stdio transport
npx -y @1mcp/agent serve --transport=stdio
```

### Custom Configuration

```bash
# Use custom configuration file
npx -y @1mcp/agent serve --config=/path/to/config.json

# Start with debug logging
npx -y @1mcp/agent serve --log-level=debug --log-file=/var/log/npx -y @1mcp/agent.log
```

### Production Deployment

```bash
# Production HTTP server with authentication
npx -y @1mcp/agent serve \
  --host=0.0.0.0 \
  --port=3051 \
  --auth \
  --enhanced-security \
  --trust-proxy=true

# With external URL for OAuth redirects
npx -y @1mcp/agent serve \
  --external-url=https://mcp.yourdomain.com \
  --auth
```

### Development

```bash
# Development with debug logging and file watching
npx -y @1mcp/agent serve \
  --log-level=debug \
  --health-info-level=full
```

### Tag Filtering

```bash
# Simple tag filtering (OR logic) - ⚠️ Deprecated
npx -y @1mcp/agent serve --transport=stdio --tags="network,filesystem"

# Advanced tag filtering (boolean expressions) - Recommended
npx -y @1mcp/agent serve --transport=stdio --tag-filter="network+api"
npx -y @1mcp/agent serve --transport=stdio --tag-filter="(web,api)+prod-test"
npx -y @1mcp/agent serve --transport=stdio --tag-filter="web and api and not test"
```

> **Note:** The `--tags` parameter is deprecated. Use `--tag-filter` for both simple and advanced filtering.

## See Also

- **[Configuration Deep Dive](../guide/essentials/configuration)**
- **[Security Guide](../reference/security)**
- **[Health Check API Reference](../reference/health-check)**
