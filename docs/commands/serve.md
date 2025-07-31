# Serve Command

Start the 1MCP server with various transport and configuration options.

## Synopsis

```bash
1mcp [serve] [options]
1mcp [options]  # serve is the default command
```

## Description

The `serve` command starts the 1MCP server, which acts as a unified proxy/multiplexer for multiple MCP servers. It can operate in different transport modes and provides a unified interface for MCP clients.

## Options

### Transport Options

- **`--transport, -t <type>`** - Transport type to use
  - **Values**: `stdio`, `http`, `sse` (deprecated)
  - **Default**: `http`

### HTTP Transport Options

- **`--port, -P <port>`** - HTTP port to listen on
  - **Default**: `3051`
  - **Environment**: `ONE_MCP_PORT`

- **`--host, -H <host>`** - HTTP host to listen on
  - **Default**: `localhost`
  - **Environment**: `ONE_MCP_HOST`

- **`--external-url <url>`** - External URL for the server
  - **Format**: `http://host:port` or `https://host:port`
  - **Environment**: `ONE_MCP_EXTERNAL_URL`

### Configuration Options

- **`--config, -c <path>`** - Path to configuration file
  - **Default**: Auto-detected based on platform
  - **Environment**: `ONE_MCP_CONFIG_PATH`

- **`--config-watch`** - Enable configuration file watching
  - **Default**: `true`
  - **Environment**: `ONE_MCP_CONFIG_WATCH`

### Logging Options

- **`--log-level <level>`** - Set logging level
  - **Values**: `error`, `warn`, `info`, `debug`
  - **Default**: `info`
  - **Environment**: `ONE_MCP_LOG_LEVEL`

- **`--log-file <path>`** - Log file path
  - **Environment**: `ONE_MCP_LOG_FILE`

### Security Options

- **`--auth`** - Enable OAuth 2.1 authentication
  - **Default**: `false`
  - **Environment**: `ONE_MCP_AUTH`

- **`--client-id <id>`** - OAuth client ID
  - **Environment**: `ONE_MCP_CLIENT_ID`

- **`--client-secret <secret>`** - OAuth client secret
  - **Environment**: `ONE_MCP_CLIENT_SECRET`

- **`--scope-validation`** - Enable scope-based authorization
  - **Default**: `false`
  - **Environment**: `ONE_MCP_SCOPE_VALIDATION`

- **`--enhanced-security`** - Enable enhanced security features
  - **Default**: `false`
  - **Environment**: `ONE_MCP_ENHANCED_SECURITY`

### Network Options

- **`--trust-proxy <config>`** - Trust proxy configuration
  - **Values**: `loopback`, `linklocal`, `uniquelocal`, IP address, subnet
  - **Default**: `loopback`
  - **Environment**: `ONE_MCP_TRUST_PROXY`

### Health Check Options

- **`--health-info-level <level>`** - Health endpoint detail level
  - **Values**: `full`, `basic`, `minimal`
  - **Default**: `minimal`
  - **Environment**: `ONE_MCP_HEALTH_INFO_LEVEL`

## Examples

### Basic Usage

```bash
# Start with default settings (HTTP on localhost:3051)
1mcp serve

# Start on custom port
1mcp serve --port=3052

# Start with stdio transport
1mcp serve --transport=stdio
```

### Custom Configuration

```bash
# Use custom configuration file
1mcp serve --config=/path/to/config.json

# Start with debug logging
1mcp serve --log-level=debug --log-file=/var/log/1mcp.log
```

### Production Deployment

```bash
# Production HTTP server with authentication
1mcp serve \
  --host=0.0.0.0 \
  --port=3051 \
  --auth \
  --client-id=your-client-id \
  --client-secret=your-client-secret \
  --enhanced-security \
  --trust-proxy=true

# With external URL for OAuth redirects
1mcp serve \
  --external-url=https://mcp.yourdomain.com \
  --auth \
  --client-id=your-client-id \
  --client-secret=your-client-secret
```

### Development

```bash
# Development with debug logging and file watching
1mcp serve \
  --log-level=debug \
  --config-watch \
  --health-info-level=full
```

## Transport Types

### HTTP Transport (Default)

HTTP transport provides a RESTful API and is recommended for most use cases:

- **Port**: Configurable (default: 3051)
- **Host**: Configurable (default: localhost)
- **Features**: OAuth authentication, health checks, metrics
- **Use case**: Desktop applications, web interfaces, remote access

### STDIO Transport

STDIO transport communicates via standard input/output:

- **Protocol**: MCP over STDIO
- **Features**: Direct process communication
- **Use case**: Command-line tools, shell scripts, embedded usage

### SSE Transport (Deprecated)

Server-Sent Events transport is deprecated in favor of HTTP transport.

## Configuration File

The server loads configuration from a JSON file that defines MCP servers and global settings. The default locations are:

- **macOS**: `~/Library/Application Support/1mcp/config.json`
- **Linux**: `~/.config/1mcp/config.json`
- **Windows**: `%APPDATA%\\1mcp\\config.json`

Example configuration:

```json
{
  "servers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["--root", "/path/to/files"],
      "env": {
        "NODE_ENV": "production"
      }
    },
    "database": {
      "transport": "http",
      "url": "https://api.example.com/mcp"
    }
  },
  "global": {
    "logLevel": "info",
    "timeout": 30000
  }
}
```

## Environment Variables

All options can be set via environment variables with the `ONE_MCP_` prefix:

```bash
export ONE_MCP_PORT=3052
export ONE_MCP_HOST=0.0.0.0
export ONE_MCP_CONFIG_PATH=/custom/config.json
export ONE_MCP_LOG_LEVEL=debug
export ONE_MCP_AUTH=true
export ONE_MCP_CLIENT_ID=your-client-id
export ONE_MCP_CLIENT_SECRET=your-client-secret
```

## Health Checks

When running in HTTP mode, the server provides health check endpoints:

- **`GET /health`** - Basic health status
- **`GET /health/detailed`** - Detailed server information (if enabled)

The detail level is controlled by the `--health-info-level` option.

## Logs

The server provides structured logging with configurable levels:

- **error**: Critical errors only
- **warn**: Warnings and errors
- **info**: General information (default)
- **debug**: Detailed debugging information

Logs can be written to a file using the `--log-file` option or viewed in the console.

## Security

For production deployments, consider enabling:

- **OAuth 2.1 Authentication**: Secure API access
- **Scope Validation**: Granular permission control
- **Enhanced Security**: Additional security headers and validation
- **Trust Proxy Configuration**: Proper proxy handling

See the [Security Guide](../reference/security.md) for detailed security configuration.
