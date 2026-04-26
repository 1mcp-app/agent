---
title: MCP Servers Configuration Reference
description: Complete reference for configuring MCP servers in 1MCP. Learn about server settings, transport types, environment variables, and JSON configuration.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'MCP servers configuration,server settings,STDIO,HTTP transport,environment variables',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Servers Configuration Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete reference for configuring MCP servers in 1MCP. Transport types and settings.',
      },
    ]
---

# MCP Servers Configuration Reference

This document provides comprehensive reference documentation for configuring MCP (Model Context Protocol) servers within the 1MCP Agent.

## Overview

The 1MCP Agent manages multiple backend MCP servers through a JSON configuration file. Shared defaults can be defined in `serverDefaults`, and each server is defined in `mcpServers` with specific properties that control its behavior, transport method, and environment.

---

## Configuration File Structure

### JSON File Structure

The agent uses a JSON file (e.g., `mcp.json`) to define backend servers and their settings.

```json
{
  "serverDefaults": {
    // Optional shared defaults for all servers
  },
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

### `serverDefaults` Section

Optional shared defaults inherited by all servers. Allowed keys:

- `env`
- `timeout`
- `connectionTimeout`
- `requestTimeout`
- `oauth`
- `headers`
- `inheritParentEnv`
- `envFilter`

Merge behavior:

- `env` object values merge with per-server env values (server keys override serverDefaults keys).
- `oauth` and `headers` are replaced by per-server values (not merged).
- Primitive values (`timeout`, `connectionTimeout`, `requestTimeout`, `inheritParentEnv`) are inherited only when missing on the server.
- Transport-specific exclusions apply: global `headers` are ignored for `stdio` transports, and global `inheritParentEnv` and `envFilter` are ignored for `http`, `sse`, and `streamableHttp` transports.
- When both `serverDefaults.env` and `mcpServers.<name>.env` use array format, the server-specific array wins instead of merging element-by-element.

### Migration Guide (Per-Server to Shared Defaults)

You can move repeated settings from each server into `serverDefaults` without changing server behavior:

1. Identify repeated keys across servers (`env`, `connectionTimeout`, `requestTimeout`, `oauth`, `headers`, `inheritParentEnv`).
2. Move shared values to `serverDefaults`.
3. Keep server-specific overrides inside each server definition.
4. Run `1mcp mcp status --verbose` to confirm each server’s effective merged configuration.

### serverDefaults Environment Variables Reference

`serverDefaults.env` supports two formats:

- Object format: `{ "KEY": "value" }`
- Array format: `["KEY=value"]`

When both `serverDefaults.env` and `mcpServers.<name>.env` are objects, values are merged and server values override serverDefaults values on key conflicts.

### `mcpServers` Section

This is a dictionary of all the backend MCP servers the agent will manage.

- **Key**: A unique, human-readable name for the server (e.g., `my-filesystem`).
- **Value**: A server configuration object.

### Server Properties

**Common Properties:**

- `transport` (string, optional): `stdio` or `http`. Defaults to `stdio` if `command` is present, `http` if `url` is present.
- `tags` (array of strings, optional): Tags for routing and access control. Required for preset filtering to work correctly.
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
  "serverDefaults": {
    "connectionTimeout": 10000,
    "requestTimeout": 30000,
    "env": {
      "HTTP_PROXY": "${HTTP_PROXY}",
      "API_KEY": "${GLOBAL_API_KEY}"
    }
  },
  "mcpServers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["--root", "/data"],
      "tags": ["files", "local-data"]
    },
    "remote-api": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer local-token"
      },
      "tags": ["api", "prod"],
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
  "envFilter": ["PATH", "HOME", "NODE_*", "NPM_*", "!SECRET_*", "!BASH_FUNC_*"]
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
  "env": ["NODE_ENV=production", "DEBUG=false", "PATH", "API_TIMEOUT=${TIMEOUT_VALUE}"]
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

      "inheritParentEnv": true,
      "envFilter": ["PATH", "HOME", "USER", "NODE_*", "NPM_*", "!SECRET_*", "!KEY_*", "!BASH_FUNC_*"],
      "env": {
        "NODE_ENV": "production",
        "API_KEY": "${PROD_API_KEY}",
        "DB_URL": "${DATABASE_CONNECTION}",
        "LOG_LEVEL": "info"
      },
      "restartOnExit": true,
      "maxRestarts": 3,
      "restartDelay": 1500,
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

## MCP Server Templates

MCP Server Templates enable dynamic, context-aware server configuration. Instead of hardcoding server settings, you can define template configurations that automatically adapt based on runtime context like the current project, user, environment, or client connection.

### Template Configuration

Templates are defined in the `mcpTemplates` section of your configuration:

::: v-pre

```json
{
  "mcpTemplates": {
    "project-filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{project.path}}"],
      "tags": ["filesystem", "project"]
    },
    "conditional-server": {
      "command": "node",
      "args": ["{{project.path}}/server.js"],
      "env": {
        "NODE_ENV": "{{project.environment}}",
        "DEBUG": "{{#if (eq project.environment 'development')}}true{{else}}false{{/if}}"
      },
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}"
    }
  }
}
```

:::

### Available Template Variables

Templates have access to four namespaces of context variables:

**Project Variables** (`project.*`):

- `project.path` - Absolute path to current project
- `project.name` - Project directory name
- `project.environment` - Environment name
- `project.git.branch` - Git branch name
- `project.custom.*` - Custom values from `.1mcprc` file

**User Variables** (`user.*`):

- `user.username` - System username
- `user.name` - User's full name
- `user.email` - User email address
- `user.home` - Home directory path

**Transport Variables** (`transport.*`):

- `transport.type` - Transport protocol (`http`, `sse`, `stdio`)
- `transport.client.name` - Client application name (`cursor`, `claude-code`)
- `transport.client.version` - Client version

### Template Syntax

1MCP uses [Handlebars](https://handlebarsjs.com/) for template rendering:

::: v-pre

```text
{{project.path}}                           <!-- Variable access -->
{{#if (eq project.environment 'production')}}  <!-- Conditionals -->
  production-value
{{else}}
  development-value
{{/if}}
{{#if (and condition1 condition2)}}        <!-- Logical operators -->
{{/if}}
```

:::

### Context Enrichment (.1mcprc)

Project-level context can be enriched with a `.1mcprc` file:

```json
{
  "preset": "my-team-preset",
  "tags": ["team-a", "backend"],
  "context": {
    "projectId": "myapp-backend",
    "environment": "development",
    "team": "platform",
    "custom": {
      "teamId": "team-a",
      "region": "us-west",
      "apiEndpoint": "https://dev-api.example.com"
    }
  }
}
```

Custom values are available as <span v-pre>`{{project.custom.*}}`</span> in templates.

### Template Settings

Control template processing behavior:

```json
{
  "templateSettings": {
    "validateOnReload": true,
    "failureMode": "graceful",
    "cacheContext": true
  }
}
```

| Setting            | Type                   | Description                                |
| ------------------ | ---------------------- | ------------------------------------------ |
| `validateOnReload` | boolean                | Validate templates when config is reloaded |
| `failureMode`      | `'strict'\|'graceful'` | How to handle template errors              |
| `cacheContext`     | boolean                | Cache rendered templates by context hash   |

For complete documentation on templates, see the [MCP Server Templates Guide](/guide/mcp-server-templates) and [Template Syntax Reference](/reference/mcp-templates/syntax).

---

## See Also

- **[Configuration Deep Dive](../guide/essentials/configuration.md)** - CLI flags and environment variables
- **[Serve Command Reference](../commands/serve.md)** - Command-line usage examples
- **[Security Guide](security.md)** - Security best practices for MCP servers
