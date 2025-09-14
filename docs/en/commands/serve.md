# Serve Command

Start the 1MCP server with various transport and configuration options.

## Synopsis

```bash
npx -y @1mcp/agent [serve] [options]
npx -y @1mcp/agent [options]  # serve is the default command
```

## Description

The `serve` command starts the 1MCP server, which acts as a unified proxy/multiplexer for multiple MCP servers. It can operate in different transport modes and provides a unified interface for MCP clients.

For a complete list of command-line flags, environment variables, and JSON configuration options, please see the **[Configuration Deep Dive](../guide/essentials/configuration.md)**. For MCP server configuration (backend servers, environment management), see the **[MCP Servers Reference](../reference/mcp-servers.md)**.

## Options

The serve command supports all configuration options. Here are the most commonly used:

### Configuration Options

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

### Transport Options

- **`--transport, -t <type>`** - Choose transport type (`stdio`, `http`)
- **`--port, -P <port>`** - Change HTTP port (default: 3050)
- **`--host, -H <host>`** - Change HTTP host (default: localhost)

### Security Options

- **`--enable-auth`** - Enable OAuth 2.1 authentication
- **`--enable-enhanced-security`** - Enable enhanced security middleware
- **`--trust-proxy <config>`** - Trust proxy configuration

### Filtering Options

- **`--tag-filter, -f <expression>`** - Advanced tag filter expression
- **`--tags, -g <tags>`** - ⚠️ Deprecated - use `--tag-filter`

### Logging Options

- **`--log-level <level>`** - Set log level (`debug`, `info`, `warn`, `error`)
- **`--log-file <path>`** - Write logs to file

For all options, see the **[Configuration Deep Dive](../guide/essentials/configuration.md)**.

## Examples

### Basic Usage

```bash
# Start with default settings (HTTP on localhost:3050)
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
npx -y @1mcp/agent serve --log-level=debug
```

### Production Deployment

```bash
# Production HTTP server with authentication
npx -y @1mcp/agent serve \
  --host=0.0.0.0 \
  --port=3051 \
  --enable-auth \
  --enable-enhanced-security \
  --trust-proxy=true

# With external URL for OAuth redirects
npx -y @1mcp/agent serve \
  --external-url=https://mcp.yourdomain.com \
  --enable-auth
```

### Development

```bash
# Development with debug logging and full health info
npx -y @1mcp/agent serve \
  --log-level=debug \
  --health-info-level=full \
  --enable-async-loading

# Development with custom config directory
npx -y @1mcp/agent serve \
  --config-dir=./dev-config \
  --log-level=debug
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

- **[Configuration Deep Dive](../guide/essentials/configuration.md)** - CLI flags and environment variables
- **[MCP Servers Reference](../reference/mcp-servers.md)** - Backend server configuration
- **[Security Guide](../reference/security.md)** - Security best practices
- **[Health Check API Reference](../reference/health-check.md)** - Monitoring endpoints
