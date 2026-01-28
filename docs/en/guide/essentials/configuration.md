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

| Option (CLI)                    | Environment Variable                  | Description                                                                                     |  Default   |
| :------------------------------ | :------------------------------------ | :---------------------------------------------------------------------------------------------- | :--------: |
| `--transport`, `-t`             | `ONE_MCP_TRANSPORT`                   | Choose transport type ("stdio", "http", or "sse")                                               |   "http"   |
| `--config`, `-c`                | `ONE_MCP_CONFIG`                      | Use a specific config file                                                                      |            |
| `--config-dir`, `-d`            | `ONE_MCP_CONFIG_DIR`                  | Path to the config directory (overrides default config location)                                |            |
| `--port`, `-P`                  | `ONE_MCP_PORT`                        | Change HTTP port                                                                                |    3050    |
| `--host`, `-H`                  | `ONE_MCP_HOST`                        | Change HTTP host                                                                                | localhost  |
| `--external-url`, `-u`          | `ONE_MCP_EXTERNAL_URL`                | External URL for OAuth callbacks and public URLs (e.g., https://example.com)                    |            |
| `--trust-proxy`                 | `ONE_MCP_TRUST_PROXY`                 | Trust proxy configuration for client IP detection (boolean, IP, CIDR, preset)                   | "loopback" |
| `--tags`, `-g`                  | `ONE_MCP_TAGS`                        | Filter servers by tags (comma-separated, OR logic) ⚠️ **Deprecated - use --tag-filter**         |            |
| `--tag-filter`, `-f`            | `ONE_MCP_TAG_FILTER`                  | Advanced tag filter expression (and/or/not logic)                                               |            |
| `--pagination`, `-p`            | `ONE_MCP_PAGINATION`                  | Enable pagination for client/server lists (boolean)                                             |   false    |
| `--enable-auth`                 | `ONE_MCP_ENABLE_AUTH`                 | Enable authentication (OAuth 2.1)                                                               |   false    |
| `--enable-scope-validation`     | `ONE_MCP_ENABLE_SCOPE_VALIDATION`     | Enable tag-based scope validation (boolean)                                                     |    true    |
| `--enable-enhanced-security`    | `ONE_MCP_ENABLE_ENHANCED_SECURITY`    | Enable enhanced security middleware (boolean)                                                   |   false    |
| `--session-ttl`                 | `ONE_MCP_SESSION_TTL`                 | Session expiry time in minutes (number)                                                         |    1440    |
| `--session-storage-path`        | `ONE_MCP_SESSION_STORAGE_PATH`        | Custom session storage directory path (string)                                                  |            |
| `--rate-limit-window`           | `ONE_MCP_RATE_LIMIT_WINDOW`           | OAuth rate limit window in minutes (number)                                                     |     15     |
| `--rate-limit-max`              | `ONE_MCP_RATE_LIMIT_MAX`              | Maximum requests per OAuth rate limit window (number)                                           |    100     |
| `--cors-origins`                | `ONE_MCP_CORS_ORIGINS`                | Comma-separated list of allowed CORS origins (empty = allow all)                                |            |
| `--enable-hsts`                 | `ONE_MCP_ENABLE_HSTS`                 | Enable HTTP Strict-Transport-Security header (boolean)                                          |   false    |
| `--token-encryption-key`        | `ONE_MCP_TOKEN_ENCRYPTION_KEY`        | Encryption key for token storage at rest (AES-256-GCM)                                          |            |
| `--enable-async-loading`        | `ONE_MCP_ENABLE_ASYNC_LOADING`        | Enable asynchronous MCP server loading(boolean)                                                 |   false    |
| `--enable-config-reload`        | `ONE_MCP_ENABLE_CONFIG_RELOAD`        | Enable configuration file hot-reload (boolean)                                                  |    true    |
| `--config-reload-debounce`      | `ONE_MCP_CONFIG_RELOAD_DEBOUNCE`      | Configuration reload debounce time in milliseconds (number)                                     |    500     |
| `--enable-env-substitution`     | `ONE_MCP_ENABLE_ENV_SUBSTITUTION`     | Enable environment variable substitution in config files (boolean)                              |    true    |
| `--enable-session-persistence`  | `ONE_MCP_ENABLE_SESSION_PERSISTENCE`  | Enable HTTP session persistence (boolean)                                                       |    true    |
| `--session-persist-requests`    | `ONE_MCP_SESSION_PERSIST_REQUESTS`    | Session persistence request threshold (number)                                                  |    100     |
| `--session-persist-interval`    | `ONE_MCP_SESSION_PERSIST_INTERVAL`    | Session persistence interval in minutes (number)                                                |     5      |
| `--session-background-flush`    | `ONE_MCP_SESSION_BACKGROUND_FLUSH`    | Session background flush interval in seconds (number)                                           |     60     |
| `--enable-client-notifications` | `ONE_MCP_ENABLE_CLIENT_NOTIFICATIONS` | Enable real-time client notifications (boolean)                                                 |    true    |
| `--enable-internal-tools`       | `ONE_MCP_ENABLE_INTERNAL_TOOLS`       | Enable ALL MCP internal tools for AI assistants (boolean)                                       |   false    |
| `--internal-tools`              | `ONE_MCP_INTERNAL_TOOLS`              | Enable specific internal tool categories (discovery,installation,management,safe)               |            |
| `--health-info-level`           | `ONE_MCP_HEALTH_INFO_LEVEL`           | Health endpoint information detail level ("full", "basic", "minimal")                           | "minimal"  |
| `--log-level`                   | `ONE_MCP_LOG_LEVEL`                   | Set the log level ("debug", "info", "warn", "error")                                            |   "info"   |
| `--log-file`                    | `ONE_MCP_LOG_FILE`                    | Write logs to a file in addition to console (disables console logging only for stdio transport) |            |
| `--help`, `-h`                  |                                       | Show help                                                                                       |            |

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

### Transport Security

Configure transport-layer security settings for production deployments.

**`--cors-origins <origins>`**

- **Purpose**: Restrict allowed CORS origins for cross-origin requests
- **Default**: Empty (allow all origins for local development)
- **Environment**: `ONE_MCP_CORS_ORIGINS`
- **Format**: Comma-separated list of URLs

**`--enable-hsts`**

- **Purpose**: Enable HTTP Strict-Transport-Security (HSTS) header
- **Default**: `false`
- **Environment**: `ONE_MCP_ENABLE_HSTS`
- **Note**: Required for HTTPS production deployments

**`--token-encryption-key <key>`**

- **Purpose**: Encryption key for OAuth tokens stored at rest (AES-256-GCM)
- **Default**: No encryption
- **Environment**: `ONE_MCP_TOKEN_ENCRYPTION_KEY`
- **Note**: Key should be at least 8 characters

**Examples:**

```bash
# Restrict CORS to specific origins for production
npx -y @1mcp/agent --cors-origins "https://app.example.com,https://admin.example.com"

# Enable HSTS for HTTPS deployments
npx -y @1mcp/agent --enable-hsts --external-url https://mcp.example.com

# Encrypt tokens at rest with a secure key
npx -y @1mcp/agent --token-encryption-key "${TOKEN_ENCRYPTION_KEY}"

# Production deployment with all security features
npx -y @1mcp/agent \
  --host 0.0.0.0 \
  --port 3051 \
  --enable-auth \
  --cors-origins "https://app.example.com" \
  --enable-hsts \
  --token-encryption-key "${TOKEN_ENCRYPTION_KEY}"

# Environment variables
ONE_MCP_CORS_ORIGINS="https://app.example.com,https://admin.example.com" \
ONE_MCP_ENABLE_HSTS=true \
ONE_MCP_TOKEN_ENCRYPTION_KEY="your-secure-key-here" \
npx -y @1mcp/agent
```

> **Security Note**: For production deployments, use all three security options together:
> - Restrict CORS to your application's origins
> - Enable HSTS when using HTTPS
> - Encrypt tokens at rest to protect sensitive data if the filesystem is compromised

For detailed security information, see the **[Security Reference](../../reference/security.md)**.

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

### Internal Tools Options

Control MCP internal tools exposure for AI assistants.

**`--enable-internal-tools`**

- **Purpose**: Enable ALL MCP internal tools for AI assistants
- **Default**: `false`
- **Environment**: `ONE_MCP_ENABLE_INTERNAL_TOOLS`

**`--internal-tools <categories>`**

- **Purpose**: Enable specific internal tool categories
- **Values**: Comma-separated categories: `discovery,installation,management,safe`
- **Default**: No categories enabled
- **Environment**: `ONE_MCP_INTERNAL_TOOLS`

**Categories**:

- `discovery` - Tools for discovering MCP servers (mcp*search, mcp_registry*\*)
- `installation` - Tools for installing/updating/removing servers (mcp_install, mcp_update, mcp_uninstall)
- `management` - Tools for managing server lifecycle (mcp_enable, mcp_disable, mcp_list, mcp_status, mcp_reload, mcp_edit)
- `safe` - Read-only tools only (subset of discovery and management)

**Examples**:

```bash
# Enable ALL internal tools
npx -y @1mcp/agent --enable-internal-tools

# Enable only discovery and management tools
npx -y @1mcp/agent --internal-tools "discovery,management"

# Enable only safe (read-only) tools
npx -y @1mcp/agent --internal-tools "safe"

# Environment variables
ONE_MCP_ENABLE_INTERNAL_TOOLS=true npx -y @1mcp/agent

ONE_MCP_INTERNAL_TOOLS="discovery,management" npx -y @1mcp/agent
```

**Important**: Internal tools are different from CLI commands. CLI commands are for human users, while internal tools are MCP protocol tools that AI assistants can use to automate server management tasks. For detailed information about available internal tools, see the **[Internal Tools Reference](../../reference/internal-tools.md)**.

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

### Configuration Reload

Control configuration file hot-reload behavior for seamless updates.

**`--enable-config-reload`**

- **Purpose**: Enable configuration file hot-reload
- **Default**: `true`
- **Environment**: `ONE_MCP_ENABLE_CONFIG_RELOAD`

**`--config-reload-debounce <milliseconds>`**

- **Purpose**: Debounce time for configuration reload to prevent excessive reloads
- **Default**: `500`
- **Environment**: `ONE_MCP_CONFIG_RELOAD_DEBOUNCE`

**Examples:**

```bash
# Enable config reload with custom debounce
npx -y @1mcp/agent --enable-config-reload --config-reload-debounce 1000

# Disable config reload (useful for production stability)
npx -y @1mcp/agent --enable-config-reload false

# Environment variables
ONE_MCP_ENABLE_CONFIG_RELOAD=true \
ONE_MCP_CONFIG_RELOAD_DEBOUNCE=200 \
npx -y @1mcp/agent
```

### Environment Variable Substitution

Enable dynamic configuration using environment variables in config files.

**`--enable-env-substitution`**

- **Purpose**: Enable environment variable substitution in configuration files
- **Default**: `true`
- **Environment**: `ONE_MCP_ENABLE_ENV_SUBSTITUTION`

**Usage:**

When enabled, you can use `${VAR_NAME}` syntax in your JSON configuration files:

```json
{
  "servers": [
    {
      "name": "database",
      "command": "python",
      "args": ["${DB_SERVER_PATH}", "--port", "${DB_PORT}"]
    }
  ],
  "auth": {
    "sessionStoragePath": "${SESSION_STORAGE_DIR}"
  }
}
```

**Examples:**

```bash
# Enable environment substitution (default)
npx -y @1mcp/agent --enable-env-substitution

# Disable environment substitution
npx -y @1mcp/agent --enable-env-substitution false

# Environment variables
DB_SERVER_PATH=/opt/db-server \
DB_PORT=5432 \
SESSION_STORAGE_DIR=/var/lib/1mcp/sessions \
ONE_MCP_ENABLE_ENV_SUBSTITUTION=true \
npx -y @1mcp/agent
```

### Session Persistence

Control HTTP session persistence for improved reliability across server restarts.

**`--enable-session-persistence`**

- **Purpose**: Enable HTTP session persistence
- **Default**: `true`
- **Environment**: `ONE_MCP_ENABLE_SESSION_PERSISTENCE`

**`--session-persist-requests <number>`**

- **Purpose**: Number of requests before triggering session persistence
- **Default**: `100`
- **Environment**: `ONE_MCP_SESSION_PERSIST_REQUESTS`

**`--session-persist-interval <minutes>`**

- **Purpose**: Time interval in minutes for automatic session persistence
- **Default**: `5`
- **Environment**: `ONE_MCP_SESSION_PERSIST_INTERVAL`

**`--session-background-flush <seconds>`**

- **Purpose**: Background flush interval in seconds for session persistence
- **Default**: `60`
- **Environment**: `ONE_MCP_SESSION_BACKGROUND_FLUSH`

**Examples:**

```bash
# Enable session persistence with default settings
npx -y @1mcp/agent --enable-session-persistence

# Custom session persistence settings
npx -y @1mcp/agent \
  --enable-session-persistence \
  --session-persist-requests 50 \
  --session-persist-interval 10 \
  --session-background-flush 30

# Disable session persistence
npx -y @1mcp/agent --enable-session-persistence false

# Environment variables
ONE_MCP_ENABLE_SESSION_PERSISTENCE=true \
ONE_MCP_SESSION_PERSIST_REQUESTS=200 \
ONE_MCP_SESSION_PERSIST_INTERVAL=15 \
npx -y @1mcp/agent
```

### Client Notifications

Control real-time notifications to connected clients about capability changes.

**`--enable-client-notifications`**

- **Purpose**: Enable real-time client notifications
- **Default**: `true`
- **Environment**: `ONE_MCP_ENABLE_CLIENT_NOTIFICATIONS`

**Examples:**

```bash
# Enable client notifications (default)
npx -y @1mcp/agent --enable-client-notifications

# Disable client notifications
npx -y @1mcp/agent --enable-client-notifications false

# Environment variable
ONE_MCP_ENABLE_CLIENT_NOTIFICATIONS=true npx -y @1mcp/agent
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
- `ONE_MCP_CORS_ORIGINS`
- `ONE_MCP_ENABLE_HSTS`
- `ONE_MCP_TOKEN_ENCRYPTION_KEY`
- `ONE_MCP_ENABLE_ASYNC_LOADING`
- `ONE_MCP_ENABLE_CONFIG_RELOAD`
- `ONE_MCP_CONFIG_RELOAD_DEBOUNCE`
- `ONE_MCP_ENABLE_ENV_SUBSTITUTION`
- `ONE_MCP_ENABLE_SESSION_PERSISTENCE`
- `ONE_MCP_SESSION_PERSIST_REQUESTS`
- `ONE_MCP_SESSION_PERSIST_INTERVAL`
- `ONE_MCP_SESSION_BACKGROUND_FLUSH`
- `ONE_MCP_ENABLE_CLIENT_NOTIFICATIONS`
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
  --enable-async-loading \
  --enable-config-reload

# Environment variables for development
ONE_MCP_LOG_LEVEL=debug \
ONE_MCP_HEALTH_INFO_LEVEL=full \
ONE_MCP_ENABLE_ASYNC_LOADING=true \
ONE_MCP_ENABLE_CONFIG_RELOAD=true \
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
  --external-url https://mcp.yourdomain.com \
  --enable-session-persistence \
  --session-persist-requests 200 \
  --session-persist-interval 10

# Docker environment variables
docker run -p 3051:3051 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3051 \
  -e ONE_MCP_ENABLE_AUTH=true \
  -e ONE_MCP_ENABLE_ENHANCED_SECURITY=true \
  -e ONE_MCP_TRUST_PROXY=true \
  -e ONE_MCP_EXTERNAL_URL=https://mcp.yourdomain.com \
  -e ONE_MCP_ENABLE_SESSION_PERSISTENCE=true \
  -e ONE_MCP_SESSION_PERSIST_REQUESTS=200 \
  -e ONE_MCP_SESSION_PERSIST_INTERVAL=10 \
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

### Advanced Feature Configuration

```bash
# Full feature-enabled configuration with environment substitution
API_KEY="${API_KEY}" \
DB_CONNECTION="${DATABASE_URL}" \
npx -y @1mcp/agent \
  --enable-config-reload \
  --config-reload-debounce 1000 \
  --enable-env-substitution \
  --enable-session-persistence \
  --session-persist-requests 150 \
  --session-persist-interval 8 \
  --enable-client-notifications \
  --log-level info

# Configuration reload only (disable other new features for stability)
npx -y @1mcp/agent \
  --enable-config-reload \
  --config-reload-debounce 2000 \
  --enable-env-substitution false \
  --enable-session-persistence false \
  --enable-client-notifications false

# Minimal configuration for high-performance environments
npx -y @1mcp/agent \
  --enable-config-reload false \
  --enable-env-substitution true \
  --enable-session-persistence false \
  --enable-client-notifications false \
  --log-level warn
```

---

## See Also

- **[MCP Servers Reference](../../reference/mcp-servers.md)** - Backend server configuration
- **[Serve Command Reference](../../commands/serve.md)** - Command-line usage examples
- **[Trust Proxy Guide](../../reference/trust-proxy.md)** - Reverse proxy configuration
- **[Health Check Reference](../../reference/health-check.md)** - Monitoring and health endpoints
- **[Security Guide](../../reference/security.md)** - Security best practices
