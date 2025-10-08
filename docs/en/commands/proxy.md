# Proxy Command

Start STDIO proxy to connect MCP clients that only support STDIO transport to a running 1MCP HTTP server.

## Synopsis

```bash
npx -y @1mcp/agent proxy [options]
```

## Description

The `proxy` command creates a STDIO transport proxy that forwards all MCP protocol communications to a running 1MCP HTTP server. This enables MCP clients that only support STDIO transport (like Claude Desktop) to connect to centralized 1MCP HTTP servers with advanced features like authentication, filtering, and multi-client support.

The proxy automatically discovers running 1MCP servers using multiple methods and provides a seamless bridge between STDIO and HTTP transports while supporting tag filtering and preset configurations.

## Auto-Discovery

The proxy automatically discovers running 1MCP servers in this order:

1. **PID File** - Reads server URL from `~/.config/1mcp/server.pid`
2. **Port Scanning** - Scans common ports (3050, 3051, 3052) on localhost
3. **Environment Variables** - Uses `ONE_MCP_HOST` and `ONE_MCP_PORT`
4. **User Override** - Uses URL specified with `--url` option

## Project Configuration (.1mcprc)

You can create a project-level configuration file named `.1mcprc` in your project directory to set default connection settings for the proxy command. This allows you to avoid repeating command-line options and share configuration across team members.

### Prerequisites

**Project configuration is specifically designed for MCP clients that:**

- **Do not support** HTTP or SSE (Server-Sent Events) transport
- **Only support** STDIO transport (like Claude Desktop)
- **Need to connect** to a running 1MCP HTTP server via proxy

**Required setup:**

1. **Running 1MCP server**: Must have `npx -y @1mcp/agent serve` running on a port
2. **MCP client limitations**: Client cannot directly connect to HTTP/SSE endpoints
3. **Bridge requirement**: Need proxy to translate STDIO ↔ HTTP communications

This configuration is **not needed** for MCP clients that can directly connect to HTTP/SSE endpoints.

### Configuration Priority

Settings are loaded in this order (higher priority overrides lower):

1. **Command-line options** (highest priority)
2. **Project configuration file** (`.1mcprc`)
3. **Default values** (lowest priority)

### Configuration Structure

Create a `.1mcprc` file in your project directory:

```json
{
  // Project-level configuration for 1MCP proxy command
  // Use preset for team collaboration and configuration management

  "preset": "my-preset"
}
```

### Recommended Approach

We recommend using presets for better configuration management and team collaboration:

1. **Create presets** for different environments (development, production, testing)
2. **Share presets** with team members for consistent configurations
3. **Switch environments** easily by changing the preset name

### Example Configurations

#### Development Environment

```json
{
  "preset": "dev-environment"
}
```

#### Production Setup

```json
{
  "preset": "production"
}
```

#### Testing Environment

```json
{
  "preset": "testing"
}
```

Copy `.1mcprc.example` from the project root as a starting template.

## Options

### Connection Options

- **`--url, -u <url>`** - Override auto-detected 1MCP server URL
- **`--timeout, -t <ms>`** - Connection timeout in milliseconds (default: 10000)

### Filtering Options

- **`--filter, -f <expression>`** - Filter expression for server selection
- **`--preset, -P <name>`** - Load preset configuration (URL, filters, etc.)

### Global Options

- **`--config-dir, -d <path>`** - Path to the config directory for discovery
- **`--log-level <level>`** - Set log level (`debug`, `info`, `warn`, `error`)
- **`--log-file <path>`** - Write logs to file

## Tag Filtering

Use the `--filter` option to limit which MCP servers are exposed through the proxy:

### Simple Filtering (OR logic)

```bash
--filter "web,api,database"  # Exposes servers with ANY of these tags
```

### Advanced Filtering (Boolean expressions)

```bash
--filter "web AND database"           # Servers with BOTH tags
--filter "(web OR api) AND database"  # Complex logic
--filter "web AND NOT test"           # Exclusion logic
```

### Priority Order

1. `--filter` option (highest priority)
2. Preset tag query (if `--preset` specified)
3. `.1mcprc` configuration file (preset only)
4. No filtering (expose all servers)

## Examples

### Basic Usage

```bash
# Auto-discover and connect to running 1MCP server
npx -y @1mcp/agent proxy

# Connect with debug logging
npx -y @1mcp/agent proxy --log-level=debug

# Use custom config directory for discovery
npx -y @1mcp/agent proxy --config-dir=./test-config

# Use project configuration file (.1mcprc)
npx -y @1mcp/agent proxy
```

### Specific Server Connection

```bash
# Connect to specific server URL
npx -y @1mcp/agent proxy --url http://localhost:3051/mcp

# Connect with custom timeout
npx -y @1mcp/agent proxy --url http://192.168.1.100:3051/mcp --timeout=5000
```

### Tag Filtering

```bash
# Only expose servers with web and api tags
npx -y @1mcp/agent proxy --filter "web AND api"

# Expose development servers
npx -y @1mcp/agent proxy --filter "dev OR test"

# Complex filtering logic
npx -y @1mcp/agent proxy --filter "(web OR mobile) AND NOT production"
```

### Preset Integration

```bash
# Load URL and filters from saved preset
npx -y @1mcp/agent proxy --preset my-dev-setup

# Use preset with custom config directory
npx -y @1mcp/agent proxy --preset production --config-dir ./prod-config
```

### Development and Testing

```bash
# Development with full logging
npx -y @1mcp/agent proxy \
  --log-level=debug \
  --log-file=proxy-debug.log \
  --config-dir=./dev-config

# Test specific server with filtering
npx -y @1mcp/agent proxy \
  --url http://localhost:3051/mcp \
  --filter "filesystem,editing" \
  --timeout=15000

# Use project configuration in development
# Create .1mcprc file with your dev preset
echo '{"preset": "dev-setup"}' > .1mcprc
npx -y @1mcp/agent proxy
```

## Authentication Considerations

### STDIO Transport Limitations

- STDIO transport does **not** support OAuth 2.1 authentication
- STDIO clients cannot authenticate with servers that have auth enabled

### Recommended Setup

#### For STDIO Clients (Claude Desktop, etc.)

```bash
# Start server WITHOUT authentication for STDIO clients
npx -y @1mcp/agent serve --port=3051

# Start proxy (will work out of the box)
npx -y @1mcp/agent proxy
```

#### For HTTP/SSE Clients

```bash
# Start server WITH authentication for web clients
npx -y @1mcp/agent serve --port=3052 --enable-auth

# HTTP/SSE clients can authenticate via OAuth
curl "http://localhost:3052/mcp?app=cursor"
```

### Mixed Environment Strategy

Run separate server instances for different client types:

- **Port 3051**: No auth for STDIO clients (via proxy)
- **Port 3052**: With auth for HTTP/SSE clients

## Workflow Integration

### Typical Development Workflow

1. **Start 1MCP Server**

   ```bash
   npx -y @1mcp/agent serve --port=3051
   ```

2. **Add MCP Servers**

   ```bash
   npx -y @1mcp/agent mcp add filesystem -- npx mcp-server-filesystem
   npx -y @1mcp/agent mcp add github -- npx mcp-server-github
   ```

3. **Create Preset (Optional)**

   ```bash
   npx -y @1mcp/agent preset create dev --filter "filesystem,github"
   ```

4. **Start Proxy**

   ```bash
   npx -y @1mcp/agent proxy --preset dev
   ```

5. **Configure Client**
   - Point Claude Desktop to the proxy command
   - Client communicates via STDIO to proxy
   - Proxy forwards to HTTP server with filtering

### Production Deployment

```bash
# Production server with filtering
npx -y @1mcp/agent serve \
  --port=3051 \
  --enable-enhanced-security

# Production proxy with preset
npx -y @1mcp/agent proxy \
  --preset production \
  --log-level=info \
  --config-dir /etc/1mcp
```

## Troubleshooting

### Common Issues

#### Server Not Found

```bash
# Check if server is running
npx -y @1mcp/agent mcp status

# Verify server URL manually
curl http://localhost:3051/mcp
```

#### Connection Timeout

```bash
# Increase timeout for slow servers
npx -y @1mcp/agent proxy --timeout=30000

# Check network connectivity
netstat -an | grep 3051
```

#### Filter Not Working

```bash
# Use debug logging to see filtering details
npx -y @1mcp/agent proxy --filter "web" --log-level=debug

# Verify server tags
npx -y @1mcp/agent mcp list --tags=web
```

### Debug Information

Enable debug logging to troubleshoot issues:

```bash
npx -y @1mcp/agent proxy --log-level=debug
```

Debug output shows:

- Server discovery attempts
- Connection establishment details
- Tag parsing and filtering logic
- MCP protocol forwarding

## See Also

- **[Serve Command](./serve.md)** - Starting 1MCP servers
- **[MCP Commands](./mcp/)** - Managing MCP server configurations
- **[Preset Commands](./preset/)** - Creating and managing presets
- **[Configuration Guide](../guide/essentials/configuration.md)** - Configuration options
- **[Claude Desktop Integration](../guide/integrations/claude-desktop.md)** - Desktop client setup
- **[Architecture Reference](../reference/architecture.md)** - Transport layer details
