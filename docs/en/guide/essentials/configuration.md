# Configuration Deep Dive

The 1MCP Agent is highly configurable, allowing you to tailor its behavior for everything from local development to production deployments. Configuration can be managed through a JSON file, command-line arguments, and environment variables, which are applied in that order of precedence.

## Configuration Methods

1.  **JSON File**: The primary method for defining servers and settings.
2.  **Command-Line Flags**: For overriding specific settings at runtime.
3.  **Environment Variables**: Useful for containerized deployments and CI/CD.

---

## 1. JSON Configuration File

The agent uses a JSON file (e.g., `mcp.json`) to define backend servers and global settings.

### Default Locations

- **macOS**: `~/.config/1mcp/mcp.json`
- **Linux**: `~/.config/1mcp/mcp.json`
- **Windows**: `%APPDATA%\1mcp\mcp.json`

You can override the path using the `--config` flag.

### Top-Level Structure

```json
{
  "mcpServers": {
    // Server definitions
  }
}
```

### `mcpServers` Section

This is a dictionary of all the backend MCP servers the agent will manage.

- **Key**: A unique, human-readable name for the server (e.g., `my-filesystem`).
- **Value**: A server configuration object.

#### Server Properties

**Common Properties:**

- `transport` (string, optional): `stdio` or `http`. Defaults to `stdio` if `command` is present, `http` if `url` is present.
- `tags` (array of strings, required): Tags for routing and access control.
- `timeout` (number, optional): Connection timeout in milliseconds.
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

#### Example `mcpServers`

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
      "timeout": 15000
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
      "timeout": 30000
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

## 2. Enhanced Environment Variable Features

The 1MCP Agent provides advanced environment variable management for stdio transport servers.

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

### Process Management

**Automatic Restart:**
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

**Working Directory:**
Set a custom working directory for the process:

```json
{
  "cwd": "/path/to/server/directory"
}
```

### Complete Example

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
      "timeout": 30000
    }
  }
}
```

---

## 3. Command-Line Flags

Flags override settings from the JSON configuration file.

### Transport Options

- `--transport, -t <type>`: Transport type (`stdio`, `http`). `sse` is deprecated.

### HTTP Transport Options

- `--port, -P <port>`: HTTP port. Default: `3050`.
- `--host, -H <host>`: HTTP host. Default: `localhost`.
- `--external-url, -u <url>`: External URL for the server (used for OAuth callbacks and public URLs).

### Configuration Options

- `--config, -c <path>`: Path to configuration file.

### Security Options

- `--auth`: Enable OAuth 2.1 authentication (deprecated, use `--enable-auth`). Default: `false`.
- `--enable-auth`: Enable authentication (OAuth 2.1). Default: `false`.
- `--enable-scope-validation`: Enable tag-based scope validation. Default: `true`.
- `--enable-enhanced-security`: Enable enhanced security middleware. Default: `false`.
- `--session-ttl <minutes>`: Session expiry time in minutes. Default: `1440` (24 hours).
- `--session-storage-path <path>`: Custom session storage directory path.
- `--rate-limit-window <minutes>`: OAuth rate limit window in minutes. Default: `15`.
- `--rate-limit-max <requests>`: Maximum requests per OAuth rate limit window. Default: `100`.

### Network Options

- `--trust-proxy <config>`: Trust proxy configuration. See [Trust Proxy Guide](/reference/trust-proxy). Default: `loopback`.

### Filtering Options

- `--tags, -g <tags>`: Tags to filter clients (comma-separated).
- `--pagination, -p`: Enable pagination. Default: `false`.

### Health Check Options

- `--health-info-level <level>`: `full`, `basic`, `minimal`. Default: `minimal`.

### Async Loading

- `--enable-async-loading`: Enables asynchronous MCP server loading.

### Logging Options

- `--log-level <level>`: Set the log level (`debug`, `info`, `warn`, `error`). Default: `info`.
- `--log-file <path>`: Write logs to a file in addition to console. When specified, console logging is disabled only for stdio transport.

#### Logging Examples

```bash
# Set log level via CLI
npx -y @1mcp/agent --log-level debug

# Log to file (disables console output)
npx -y @1mcp/agent --log-file /var/log/1mcp.log

# Combined logging configuration
npx -y @1mcp/agent --log-level debug --log-file app.log

# Using environment variables
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent
ONE_MCP_LOG_FILE=/var/log/1mcp.log npx -y @1mcp/agent
```

#### Migration from LOG_LEVEL

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

## 3. Environment Variables

Environment variables are prefixed with `ONE_MCP_` and are useful for containerized environments. They override both JSON and CLI settings.

- `ONE_MCP_PORT`
- `ONE_MCP_HOST`
- `ONE_MCP_EXTERNAL_URL`
- `ONE_MCP_CONFIG_PATH`
- `ONE_MCP_CONFIG_WATCH`
- `ONE_MCP_LOG_LEVEL`
- `ONE_MCP_LOG_FILE`
- `ONE_MCP_TAGS`
- `ONE_MCP_PAGINATION`
- `ONE_MCP_AUTH`
- `ONE_MCP_ENABLE_AUTH`
- `ONE_MCP_ENABLE_SCOPE_VALIDATION`
- `ONE_MCP_ENABLE_ENHANCED_SECURITY`
- `ONE_MCP_SESSION_TTL`
- `ONE_MCP_SESSION_STORAGE_PATH`
- `ONE_MCP_RATE_LIMIT_WINDOW`
- `ONE_MCP_RATE_LIMIT_MAX`
- `ONE_MCP_TRUST_PROXY`
- `ONE_MCP_HEALTH_INFO_LEVEL`
- `ONE_MCP_ENABLE_ASYNC_LOADING`

---

## Hot-Reloading

The agent supports hot-reloading of the configuration file. If you modify the JSON file while the agent is running, it will automatically apply the new configuration without a restart.
