---
title: Serve Command - Start the 1MCP Server
description: Start the 1MCP server with serve command. Learn transport options, configuration flags, and how to run the server.
head:
  - ['meta', { name: 'keywords', content: '1MCP serve command,start server,transport options,configuration' }]
  - ['meta', { property: 'og:title', content: '1MCP Serve Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Start the 1MCP server with serve command. Transport and configuration options.',
      },
    ]
---

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
- **`--cors-origins <origins>`** - Comma-separated list of allowed CORS origins
- **`--enable-hsts`** - Enable HTTP Strict-Transport-Security header
- **`--token-encryption-key <key>`** - Encryption key for token storage at rest

### Filtering Options

- **`--tag-filter, -f <expression>`** - Advanced tag filter expression
- **`--tags, -g <tags>`** - ⚠️ Deprecated - use `--tag-filter`

### Advanced Configuration Options

- **`--enable-config-reload`** - Enable configuration file hot-reload
- **`--enable-env-substitution`** - Enable environment variable substitution
- **`--enable-session-persistence`** - Enable HTTP session persistence
- **`--enable-client-notifications`** - Enable real-time client notifications

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

### Production Deployment with Full Security

```bash
# Production deployment with all security features
npx -y @1mcp/agent serve \
  --host=0.0.0.0 \
  --port=3051 \
  --external-url=https://mcp.yourdomain.com \
  --enable-auth \
  --enable-enhanced-security \
  --trust-proxy=true \
  --cors-origins="https://app.yourdomain.com,https://admin.yourdomain.com" \
  --enable-hsts \
  --token-encryption-key="${TOKEN_ENCRYPTION_KEY}"

# Using environment variables
export ONE_MCP_CORS_ORIGINS="https://app.yourdomain.com,https://admin.yourdomain.com"
export ONE_MCP_ENABLE_HSTS=true
export ONE_MCP_TOKEN_ENCRYPTION_KEY="your-secure-encryption-key"

npx -y @1mcp/agent serve \
  --host=0.0.0.0 \
  --port=3051 \
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
  --log-level=debug \
  --enable-config-reload
```

### Advanced Configuration

```bash
# Development with all advanced features enabled
npx -y @1mcp/agent serve \
  --log-level=debug \
  --enable-config-reload \
  --config-reload-debounce=1000 \
  --enable-env-substitution \
  --enable-session-persistence \
  --session-persist-requests=50 \
  --enable-client-notifications

# Production with optimized session persistence
npx -y @1mcp/agent serve \
  --host=0.0.0.0 \
  --port=3051 \
  --enable-auth \
  --enable-session-persistence \
  --session-persist-requests=200 \
  --session-persist-interval=10 \
  --session-background-flush=30 \
  --enable-client-notifications

# High-performance setup (minimal features)
npx -y @1mcp/agent serve \
  --transport=stdio \
  --enable-config-reload=false \
  --enable-env-substitution=true \
  --enable-session-persistence=false \
  --enable-client-notifications=false \
  --log-level=warn
```

### Environment Variable Substitution

```bash
# Using environment variables in configuration files
API_KEY="${API_KEY}" \
DATABASE_URL="${DATABASE_URL}" \
SESSION_DIR="${SESSION_STORAGE_DIR}" \
npx -y @1mcp/agent serve \
  --enable-env-substitution \
  --config-dir=./config

# Combined with configuration reload for dynamic updates
API_BASE_URL="${API_BASE_URL}" \
npx -y @1mcp/agent serve \
  --enable-env-substitution \
  --enable-config-reload \
  --config-reload-debounce=2000
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
