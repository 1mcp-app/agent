---
title: Configuration Guide - CLI Flags and Environment Variables
description: Complete 1MCP configuration reference. Learn about command-line flags, environment variables, transport options, authentication, and runtime behavior settings.
head:
  - ['meta', { name: 'keywords', content: '1MCP configuration,CLI flags,environment variables,transport settings' }]
  - ['meta', { property: 'og:title', content: '1MCP Configuration Guide - Complete Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete configuration reference for 1MCP Agent. CLI flags, environment variables, and runtime settings.',
      },
    ]
---

# Configuration Deep Dive

The 1MCP Agent provides extensive configuration options for runtime behavior, transport settings, authentication, and more. This guide covers command-line flags and environment variables that control how the agent operates.

For MCP server configuration (backend servers, environment management, process control), see the **[MCP Servers Reference](../../reference/mcp-servers.md)**.

## Configuration Methods

The agent supports three configuration methods, applied in this order of precedence:

1. **Environment Variables**: Highest priority, useful for containerized deployments
2. **Command-Line Flags**: Override settings at runtime
3. **Configuration File**: Base configuration (covered in MCP Servers Reference)

---

## Command-Line Options

All available command-line options and their corresponding environment variables:

| Option (CLI)                 | Environment Variable               | Description                                                                                     |  Default   |
| :--------------------------- | :--------------------------------- | :---------------------------------------------------------------------------------------------- | :--------: |
| `--transport`, `-t`          | `ONE_MCP_TRANSPORT`                | Choose transport type ("stdio", "http", or "sse")                                               |   "http"   |
| `--config`, `-c`             | `ONE_MCP_CONFIG`                   | Use a specific config file                                                                      |            |
| `--config-dir`, `-d`         | `ONE_MCP_CONFIG_DIR`               | Path to the config directory (overrides default config location)                                |            |
| `--port`, `-P`               | `ONE_MCP_PORT`                     | Change HTTP port                                                                                |    3050    |
| `--host`, `-H`               | `ONE_MCP_HOST`                     | Change HTTP host                                                                                | localhost  |
| `--external-url`, `-u`       | `ONE_MCP_EXTERNAL_URL`             | External URL for OAuth callbacks and public URLs (e.g., https://example.com)                    |            |
| `--trust-proxy`              | `ONE_MCP_TRUST_PROXY`              | Trust proxy configuration for client IP detection (boolean, IP, CIDR, preset)                   | "loopback" |
| `--tags`, `-g`               | `ONE_MCP_TAGS`                     | Filter servers by tags (comma-separated, OR logic) ⚠️ **Deprecated - use --tag-filter**         |            |
| `--tag-filter`, `-f`         | `ONE_MCP_TAG_FILTER`               | Advanced tag filter expression (and/or/not logic)                                               |            |
| `--pagination`, `-p`         | `ONE_MCP_PAGINATION`               | Enable pagination for client/server lists (boolean)                                             |   false    |
| `--enable-auth`              | `ONE_MCP_ENABLE_AUTH`              | Enable authentication (OAuth 2.1)                                                               |   false    |
| `--enable-scope-validation`  | `ONE_MCP_ENABLE_SCOPE_VALIDATION`  | Enable tag-based scope validation (boolean)                                                     |    true    |
| `--enable-enhanced-security` | `ONE_MCP_ENABLE_ENHANCED_SECURITY` | Enable enhanced security middleware (boolean)                                                   |   false    |
| `--session-ttl`              | `ONE_MCP_SESSION_TTL`              | Session expiry time in minutes (number)                                                         |    1440    |
| `--session-storage-path`     | `ONE_MCP_SESSION_STORAGE_PATH`     | Custom session storage directory path (string)                                                  |            |
| `--rate-limit-window`        | `ONE_MCP_RATE_LIMIT_WINDOW`        | OAuth rate limit window in minutes (number)                                                     |     15     |
| `--rate-limit-max`           | `ONE_MCP_RATE_LIMIT_MAX`           | Maximum requests per OAuth rate limit window (number)                                           |    100     |
| `--enable-async-loading`     | `ONE_MCP_ENABLE_ASYNC_LOADING`     | Enable asynchronous MCP server loading(boolean)                                                 |   false    |
| `--health-info-level`        | `ONE_MCP_HEALTH_INFO_LEVEL`        | Health endpoint information detail level ("full", "basic", "minimal")                           | "minimal"  |
| `--log-level`                | `ONE_MCP_LOG_LEVEL`                | Set the log level ("debug", "info", "warn", "error")                                            |   "info"   |
| `--log-file`                 | `ONE_MCP_LOG_FILE`                 | Write logs to a file in addition to console (disables console logging only for stdio transport) |            |
| `--help`, `-h`               |                                    | Show help                                                                                       |            |

---

## Configuration Categories

### Transport Options

Control how the agent communicates with clients and backend servers.

**`--transport, -t <type>`**

- **Values**: `stdio`, `http`, `sse` (deprecated)
- **Default**: `http`
- **Environment**: `ONE_MCP_TRANSPORT`

**Examples:**

```bash
# HTTP transport (default)
npx -y @1mcp/agent --transport http

# Stdio transport for direct MCP client integration
npx -y @1mcp/agent --transport stdio

# Using environment variable
ONE_MCP_TRANSPORT=stdio npx -y @1mcp/agent
```

### Network Configuration

Configure HTTP server settings for network access.

**`--port, -P <port>`**

- **Default**: `3050`
- **Environment**: `ONE_MCP_PORT`

**`--host, -H <host>`**

- **Default**: `localhost`
- **Environment**: `ONE_MCP_HOST`

**`--external-url, -u <url>`**

- **Purpose**: External URL for OAuth callbacks and public URLs
- **Environment**: `ONE_MCP_EXTERNAL_URL`

**Examples:**

```bash
# Custom port and host
npx -y @1mcp/agent --port 3051 --host 0.0.0.0

# External URL for reverse proxy setups
npx -y @1mcp/agent --external-url https://mcp.example.com

# Environment variables for Docker
ONE_MCP_HOST=0.0.0.0 ONE_MCP_PORT=3051 npx -y @1mcp/agent
```

### Configuration Management

Control configuration file location and loading behavior.

**`--config, -c <path>`**

- **Purpose**: Use a specific config file
- **Environment**: `ONE_MCP_CONFIG`

**`--config-dir, -d <path>`**

- **Purpose**: Path to the config directory (overrides default location)
- **Environment**: `ONE_MCP_CONFIG_DIR`

**Examples:**

```bash
# Use specific config file
npx -y @1mcp/agent --config ./my-config.json

# Use custom config directory
npx -y @1mcp/agent --config-dir ./project-config

# Environment variable for config directory
ONE_MCP_CONFIG_DIR=/opt/1mcp/config npx -y @1mcp/agent
```

### Security Configuration

Authentication, authorization, and security features.

**`--enable-auth`**

- **Purpose**: Enable OAuth 2.1 authentication
- **Default**: `false`
- **Environment**: `ONE_MCP_ENABLE_AUTH`

**`--enable-scope-validation`**

- **Purpose**: Enable tag-based scope validation
- **Default**: `true`
- **Environment**: `ONE_MCP_ENABLE_SCOPE_VALIDATION`

**`--enable-enhanced-security`**

- **Purpose**: Enable enhanced security middleware
- **Default**: `false`
- **Environment**: `ONE_MCP_ENABLE_ENHANCED_SECURITY`

**Session Management:**

- `--session-ttl <minutes>`: Session expiry time (default: 1440)
- `--session-storage-path <path>`: Custom session storage directory
- `--rate-limit-window <minutes>`: OAuth rate limit window (default: 15)
- `--rate-limit-max <requests>`: Maximum requests per window (default: 100)

**Examples:**

```bash
# Enable authentication with enhanced security
npx -y @1mcp/agent --enable-auth --enable-enhanced-security

# Custom session configuration
npx -y @1mcp/agent \
  --enable-auth \
  --session-ttl 720 \
  --rate-limit-window 10 \
  --rate-limit-max 50

# Environment variables
ONE_MCP_ENABLE_AUTH=true \
ONE_MCP_ENABLE_ENHANCED_SECURITY=true \
npx -y @1mcp/agent
```

### Network Security

Configure trust proxy settings for reverse proxy deployments.

**`--trust-proxy <config>`**

- **Default**: `"loopback"`
- **Environment**: `ONE_MCP_TRUST_PROXY`
- **Values**:
  - `true`: Trust all proxies
  - `false`: Trust no proxies
  - IP address: Trust specific IP
  - CIDR: Trust IP range
  - `"loopback"`: Trust loopback addresses only

**Examples:**

```bash
# Trust all proxies (CDN/Cloudflare)
npx -y @1mcp/agent --trust-proxy true

# Trust specific proxy IP
npx -y @1mcp/agent --trust-proxy 192.168.1.100

# Trust IP range
npx -y @1mcp/agent --trust-proxy 10.0.0.0/8
```

For detailed trust proxy configuration, see the **[Trust Proxy Reference](../../reference/trust-proxy.md)**.

### Server Filtering

Control which backend MCP servers are loaded and available.

**`--tags, -g <tags>`** ⚠️ **Deprecated**

- **Purpose**: Filter servers by tags (comma-separated, OR logic)
- **Environment**: `ONE_MCP_TAGS`

**`--tag-filter, -f <expression>`** ✅ **Recommended**

- **Purpose**: Advanced tag filter expression with boolean logic
- **Environment**: `ONE_MCP_TAG_FILTER`

**Tag Filter Syntax:**

- `tag1,tag2`: OR logic (either tag)
- `tag1+tag2`: AND logic (both tags)
- `(tag1,tag2)+tag3`: Complex expressions
- `tag1 and tag2 and not tag3`: Natural language syntax

**Examples:**

```bash
# Simple OR filtering (deprecated)
npx -y @1mcp/agent --tags "network,filesystem"

# Advanced filtering (recommended)
npx -y @1mcp/agent --tag-filter "network+api"
npx -y @1mcp/agent --tag-filter "(web,api)+production-test"
npx -y @1mcp/agent --tag-filter "web and api and not test"

# Environment variables
ONE_MCP_TAG_FILTER="network+api" npx -y @1mcp/agent
```

### Performance Options

Control performance and resource usage behavior.

**`--enable-async-loading`**

- **Purpose**: Enable asynchronous MCP server loading
- **Default**: `false`
- **Environment**: `ONE_MCP_ENABLE_ASYNC_LOADING`

**`--pagination, -p`**

- **Purpose**: Enable pagination for client/server lists
- **Default**: `false`
- **Environment**: `ONE_MCP_PAGINATION`

**Examples:**

```bash
# Enable async loading for faster startup
npx -y @1mcp/agent --enable-async-loading

# Enable pagination for large server lists
npx -y @1mcp/agent --pagination

# Environment variables
ONE_MCP_ENABLE_ASYNC_LOADING=true \
ONE_MCP_PAGINATION=true \
npx -y @1mcp/agent
```

### Monitoring and Health

Configure health check endpoints and information detail levels.

**`--health-info-level <level>`**

- **Values**: `"full"`, `"basic"`, `"minimal"`
- **Default**: `"minimal"`
- **Environment**: `ONE_MCP_HEALTH_INFO_LEVEL`

**Levels:**

- `minimal`: Basic health status only
- `basic`: Health status with basic metrics
- `full`: Complete system information and metrics

**Examples:**

```bash
# Full health information for monitoring
npx -y @1mcp/agent --health-info-level full

# Basic health information
npx -y @1mcp/agent --health-info-level basic

# Environment variable
ONE_MCP_HEALTH_INFO_LEVEL=full npx -y @1mcp/agent
```

For detailed health check information, see the **[Health Check Reference](../../reference/health-check.md)**.

### Logging Configuration

Control log output, levels, and destinations.

**`--log-level <level>`**

- **Values**: `"debug"`, `"info"`, `"warn"`, `"error"`
- **Default**: `"info"`
- **Environment**: `ONE_MCP_LOG_LEVEL`

**`--log-file <path>`**

- **Purpose**: Write logs to file in addition to console
- **Note**: Disables console logging only for stdio transport
- **Environment**: `ONE_MCP_LOG_FILE`

**Examples:**

```bash
# Debug logging
npx -y @1mcp/agent --log-level debug

# Log to file
npx -y @1mcp/agent --log-file /var/log/1mcp.log

# Combined logging configuration
npx -y @1mcp/agent --log-level debug --log-file app.log

# Environment variables
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent
ONE_MCP_LOG_FILE=/var/log/1mcp.log npx -y @1mcp/agent
```

**Migration from Legacy LOG_LEVEL:**
The legacy `LOG_LEVEL` environment variable is still supported but deprecated:

```bash
# ⚠️  Deprecated (shows warning)
LOG_LEVEL=debug npx -y @1mcp/agent

# ✅ Recommended
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent
# or
npx -y @1mcp/agent --log-level debug
```

---

## Environment Variables Reference

All environment variables are prefixed with `ONE_MCP_` and override both configuration file and CLI settings:

- `ONE_MCP_TRANSPORT`
- `ONE_MCP_CONFIG`
- `ONE_MCP_CONFIG_DIR`
- `ONE_MCP_PORT`
- `ONE_MCP_HOST`
- `ONE_MCP_EXTERNAL_URL`
- `ONE_MCP_TRUST_PROXY`
- `ONE_MCP_TAGS` (deprecated)
- `ONE_MCP_TAG_FILTER`
- `ONE_MCP_PAGINATION`
- `ONE_MCP_ENABLE_AUTH`
- `ONE_MCP_ENABLE_SCOPE_VALIDATION`
- `ONE_MCP_ENABLE_ENHANCED_SECURITY`
- `ONE_MCP_SESSION_TTL`
- `ONE_MCP_SESSION_STORAGE_PATH`
- `ONE_MCP_RATE_LIMIT_WINDOW`
- `ONE_MCP_RATE_LIMIT_MAX`
- `ONE_MCP_ENABLE_ASYNC_LOADING`
- `ONE_MCP_HEALTH_INFO_LEVEL`
- `ONE_MCP_LOG_LEVEL`
- `ONE_MCP_LOG_FILE`

---

## Configuration Examples

### Development Setup

```bash
# Development with debug logging and full health info
npx -y @1mcp/agent \
  --log-level debug \
  --health-info-level full \
  --enable-async-loading

# Environment variables for development
ONE_MCP_LOG_LEVEL=debug \
ONE_MCP_HEALTH_INFO_LEVEL=full \
ONE_MCP_ENABLE_ASYNC_LOADING=true \
npx -y @1mcp/agent
```

### Production Deployment

```bash
# Production HTTP server with authentication
npx -y @1mcp/agent \
  --host 0.0.0.0 \
  --port 3051 \
  --enable-auth \
  --enable-enhanced-security \
  --trust-proxy true \
  --external-url https://mcp.yourdomain.com

# Docker environment variables
docker run -p 3051:3051 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3051 \
  -e ONE_MCP_ENABLE_AUTH=true \
  -e ONE_MCP_ENABLE_ENHANCED_SECURITY=true \
  -e ONE_MCP_TRUST_PROXY=true \
  -e ONE_MCP_EXTERNAL_URL=https://mcp.yourdomain.com \
  ghcr.io/1mcp-app/agent
```

### Filtered Server Access

```bash
# Only network-capable servers
npx -y @1mcp/agent --transport stdio --tag-filter "network"

# Complex filtering: (web OR api) AND production, NOT test
npx -y @1mcp/agent --transport stdio --tag-filter "(web,api)+production-test"

# Natural language filtering
npx -y @1mcp/agent --transport stdio --tag-filter "api and database and not test"
```

---

## See Also

- **[MCP Servers Reference](../../reference/mcp-servers.md)** - Backend server configuration
- **[Serve Command Reference](../../commands/serve.md)** - Command-line usage examples
- **[Trust Proxy Guide](../../reference/trust-proxy.md)** - Reverse proxy configuration
- **[Health Check Reference](../../reference/health-check.md)** - Monitoring and health endpoints
- **[Security Guide](../../reference/security.md)** - Security best practices
