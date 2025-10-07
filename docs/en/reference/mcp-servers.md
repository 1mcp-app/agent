# MCP Servers Configuration Reference

This document provides comprehensive reference documentation for configuring MCP (Model Context Protocol) servers within the 1MCP Agent.

## Overview

The 1MCP Agent manages multiple backend MCP servers through a JSON configuration file. Each server is defined in the `mcpServers` section with specific properties that control its behavior, transport method, and environment.

---

## Configuration File Structure

### JSON File Structure

The agent uses a JSON file (e.g., `mcp.json`) to define backend servers and their settings.

```json
{
  "mcpServers": {
    // Server definitions
  }
}
```

### Default Locations

- **macOS**: `~/.config/1mcp/mcp.json`
- **Linux**: `~/.config/1mcp/mcp.json`
- **Windows**: `%APPDATA%\1mcp\mcp.json`

### Config Directory Override

The agent supports overriding the entire config directory location, which affects where the configuration file, backups, and other related files are stored.

**Default Locations:**

- **macOS**: `~/.config/1mcp/`
- **Linux**: `~/.config/1mcp/`
- **Windows**: `%APPDATA%\1mcp\`

**Override Methods:**

1. **Command Line Flag:**

   ```bash
   npx -y @1mcp/agent --config-dir /custom/config/path
   ```

2. **Environment Variable:**
   ```bash
   ONE_MCP_CONFIG_DIR=/custom/config/path npx -y @1mcp/agent
   ```

When you override the config directory, the agent will:

- Look for `mcp.json` in the specified directory
- Store backups in a `backups` subdirectory
- Store presets and other configuration files in the specified directory

**Example:**

```bash
# Use a project-specific config directory
npx -y @1mcp/agent --config-dir ./project-config
```

This creates a self-contained configuration setup for projects that need isolated configurations.

---

## MCP Servers Configuration

### `mcpServers` Section

This is a dictionary of all the backend MCP servers the agent will manage.

- **Key**: A unique, human-readable name for the server (e.g., `my-filesystem`).
- **Value**: A server configuration object.

### Server Properties

**Common Properties:**

- `transport` (string, optional): `stdio` or `http`. Defaults to `stdio` if `command` is present, `http` if `url` is present.
- `tags` (array of strings, required): Tags for routing and access control.
- `connectionTimeout` (number, optional): Connection timeout in milliseconds. Used when establishing initial connection. Takes precedence over `timeout`.
- `requestTimeout` (number, optional): Request timeout in milliseconds. Used for individual MCP operations (callTool, readResource, etc.). Takes precedence over `timeout`.
- `timeout` (number, optional): **Deprecated** fallback timeout in milliseconds. Used when specific timeouts are not set. New configurations should use `connectionTimeout` and `requestTimeout`.
- `enabled` (boolean, optional): Set to `false` to disable the server. Defaults to `true`.

**HTTP Transport Properties:**

- `url` (string, required for `http`): The URL for the remote MCP server.

**Stdio Transport Properties:**

- `command` (string, required for `stdio`): The command to execute.
- `args` (array of strings, optional): Arguments for the command.
- `cwd` (string, optional): Working directory for the process.
- `env` (object or array, optional): Environment variables. Can be an object `{"KEY": "value"}` or array `["KEY=value", "PATH"]`.
- `inheritParentEnv` (boolean, optional): Inherit environment variables from parent process. Defaults to `false`.
- `envFilter` (array of strings, optional): Patterns for filtering inherited environment variables. Supports `*` wildcards and `!` for exclusion.
- `restartOnExit` (boolean, optional): Automatically restart the process when it exits. Defaults to `false`.
- `maxRestarts` (number, optional): Maximum number of restart attempts. If not specified, unlimited restarts are allowed.
- `restartDelay` (number, optional): Delay in milliseconds between restart attempts. Defaults to `1000` (1 second).

### Configuration Examples

**Basic Configuration:**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["--root", "/data"],
      "tags": ["files", "local-data"]
    },
    "remote-api": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "tags": ["api", "prod"],
      "connectionTimeout": 5000,
      "requestTimeout": 15000
    }
  }
}
```

**Enhanced Stdio Configuration:**

```json
{
  "mcpServers": {
    "enhanced-server": {
      "command": "node",
      "args": ["server.js"],
      "cwd": "/app",
      "inheritParentEnv": true,
      "envFilter": ["PATH", "HOME", "NODE_*", "!SECRET_*", "!BASH_FUNC_*"],
      "env": {
        "NODE_ENV": "production",
        "API_KEY": "${MCP_API_KEY}",
        "DEBUG": "false"
      },
      "restartOnExit": true,
      "maxRestarts": 5,
      "restartDelay": 2000,
      "tags": ["production", "api"],
      "connectionTimeout": 10000,
      "requestTimeout": 30000
    }
  }
}
```

**Array Environment Format:**

```json
{
  "mcpServers": {
    "array-env-server": {
      "command": "python",
      "args": ["server.py"],
      "env": ["PATH", "NODE_ENV=production", "API_KEY=${SECRET_KEY}"],
      "tags": ["python", "api"]
    }
  }
}
```

---

## Advanced Environment Management

### Environment Variable Substitution

Use `${VARIABLE_NAME}` syntax in your configuration to substitute environment variables at runtime:

```json
{
  "mcpServers": {
    "dynamic-server": {
      "command": "${SERVER_COMMAND}",
      "args": ["--port", "${SERVER_PORT}"],
      "env": {
        "API_KEY": "${SECRET_API_KEY}",
        "DATABASE_URL": "${DB_CONNECTION_STRING}"
      },
      "tags": ["dynamic"]
    }
  }
}
```

### Environment Inheritance and Filtering

**Inherit Parent Environment:**
Set `inheritParentEnv: true` to inherit environment variables from the parent process:

```json
{
  "inheritParentEnv": true
}
```

**Environment Filtering:**
Use `envFilter` to control which variables are inherited using pattern matching:

```json
{
  "inheritParentEnv": true,
  "envFilter": [
    "PATH", // Allow PATH variable
    "HOME", // Allow HOME variable
    "NODE_*", // Allow all NODE_* variables
    "NPM_*", // Allow all NPM_* variables
    "!SECRET_*", // Block all SECRET_* variables
    "!BASH_FUNC_*" // Block bash function definitions
  ]
}
```

**Filter Patterns:**

- `VARIABLE_NAME`: Include specific variable
- `PREFIX_*`: Include all variables starting with PREFIX\_
- `!VARIABLE_NAME`: Exclude specific variable
- `!PREFIX_*`: Exclude all variables starting with PREFIX\_

### Flexible Environment Formats

**Object Format (Traditional):**

```json
{
  "env": {
    "NODE_ENV": "production",
    "DEBUG": "false",
    "API_TIMEOUT": "30000"
  }
}
```

**Array Format (Docker-style):**

```json
{
  "env": [
    "NODE_ENV=production",
    "DEBUG=false",
    "PATH", // Inherit PATH from parent
    "API_TIMEOUT=${TIMEOUT_VALUE}"
  ]
}
```

---

## Process Management

### Automatic Restart

Enable automatic process restart when the server exits unexpectedly:

```json
{
  "restartOnExit": true,
  "maxRestarts": 5,
  "restartDelay": 2000
}
```

**Restart Configuration Options:**

- `restartOnExit`: Enable automatic restart functionality
- `maxRestarts`: Limit restart attempts (omit for unlimited restarts)
- `restartDelay`: Milliseconds to wait between restart attempts (default: 1000ms)

### Working Directory

Set a custom working directory for the process:

```json
{
  "cwd": "/path/to/server/directory"
}
```

---

## Complete Configuration Example

```json
{
  "mcpServers": {
    "production-server": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/app",

      // Environment inheritance with security filtering
      "inheritParentEnv": true,
      "envFilter": [
        "PATH",
        "HOME",
        "USER", // Basic system vars
        "NODE_*",
        "NPM_*", // Node.js related
        "!SECRET_*",
        "!KEY_*", // Block secrets
        "!BASH_FUNC_*" // Block functions
      ],

      // Custom environment with substitution
      "env": {
        "NODE_ENV": "production",
        "API_KEY": "${PROD_API_KEY}",
        "DB_URL": "${DATABASE_CONNECTION}",
        "LOG_LEVEL": "info"
      },

      // Process management
      "restartOnExit": true,
      "maxRestarts": 3,
      "restartDelay": 1500,

      // Standard MCP properties
      "tags": ["production", "api"],
      "connectionTimeout": 10000,
      "requestTimeout": 30000
    }
  }
}
```

---

## Timeout Configuration

### Timeout Hierarchy

1MCP Agent supports granular timeout configuration with the following precedence hierarchy:

- **Connection Operations**: `connectionTimeout` > `timeout` (fallback)
- **Request Operations**: `requestTimeout` > `timeout` (fallback)

### Timeout Types

**`connectionTimeout`**

- **Purpose**: Timeout for establishing initial connection to MCP server
- **Used when**: Calling `client.connect()` during server startup or retry
- **Units**: Milliseconds
- **Recommended**: 5000-15000ms (5-15 seconds) depending on network conditions

**`requestTimeout`**

- **Purpose**: Timeout for individual MCP operations (tools, resources, etc.)
- **Used when**: `callTool()`, `readResource()`, `listRoots()`, etc.
- **Units**: Milliseconds
- **Recommended**: 15000-60000ms (15-60 seconds) depending on operation complexity

**`timeout` (Deprecated)**

- **Purpose**: Fallback timeout when specific timeouts are not set
- **Status**: Deprecated for new configurations
- **Behavior**: Used as fallback for both connection and request operations

### Timeout Examples

**Granular Timeout Configuration:**

```json
{
  "mcpServers": {
    "fast-api": {
      "transport": "http",
      "url": "https://fast-api.example.com/mcp",
      "connectionTimeout": 3000,
      "requestTimeout": 10000,
      "tags": ["api", "fast"]
    },
    "heavy-processor": {
      "transport": "http",
      "url": "https://heavy.example.com/mcp",
      "connectionTimeout": 10000,
      "requestTimeout": 120000,
      "tags": ["processing", "slow"]
    },
    "backward-compatible": {
      "transport": "http",
      "url": "https://legacy.example.com/mcp",
      "timeout": 30000,
      "tags": ["legacy"]
    }
  }
}
```

**Transport-Specific Considerations:**

- **HTTP/SSE Transports**: Require longer connection timeouts due to network latency
- **STDIO Transports**: Typically need shorter connection timeouts (local process)
- **Retry Logic**: Failed connections trigger transport recreation for HTTP/SSE

### Migration from Single Timeout

**Before (Deprecated):**

```json
{
  "timeout": 30000
}
```

**After (Recommended):**

```json
{
  "connectionTimeout": 5000,
  "requestTimeout": 30000
}
```

---

## Hot-Reloading

The agent supports hot-reloading of the configuration file. If you modify the JSON file while the agent is running, it will automatically apply the new configuration without a restart.

---

## See Also

- **[Configuration Deep Dive](../guide/essentials/configuration.md)** - CLI flags and environment variables
- **[Serve Command Reference](../commands/serve.md)** - Command-line usage examples
- **[Security Guide](security.md)** - Security best practices for MCP servers
