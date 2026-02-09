---
title: MCP Server Templates - Dynamic Server Configuration
description: Learn how to use MCP Server Templates in 1MCP for dynamic, context-aware server configuration with Handlebars variables.
head:
  - ['meta', { name: 'keywords', content: 'MCP server templates,Handlebars,dynamic configuration,context-aware' }]
  - ['meta', { property: 'og:title', content: '1MCP Server Templates Guide' }]
  - [
      'meta',
      { property: 'og:description', content: 'Dynamic MCP server configuration with templates and context variables.' },
    ]
---

# MCP Server Templates

MCP Server Templates enable dynamic, context-aware server configuration. Instead of hardcoding server settings, you can define template configurations that automatically adapt based on runtime context like the current project, user, environment, or client connection.

## Overview

Templates allow you to:

- **Dynamic server creation**: Spawn different servers based on project context
- **Environment-aware configuration**: Automatically adjust settings per environment
- **Context enrichment**: Inject project-specific metadata into server configurations
- **Conditional enablement**: Enable/disable servers based on runtime conditions

### Templates vs. Static Servers

1MCP supports two types of server configurations:

| Feature            | Static Servers (`mcpServers`) | Template Servers (`mcpTemplates`) |
| ------------------ | ----------------------------- | --------------------------------- |
| Configuration      | Fixed values at startup       | Dynamic values based on context   |
| Context awareness  | None                          | Project, user, transport, client  |
| Multiple instances | Single instance per config    | Multiple instances per context    |
| Lifecycle          | Always running                | Created on-demand per connection  |
| Use case           | Stable infrastructure         | Dynamic, context-specific tools   |

### Key Difference from Instruction Templates

**MCP Server Templates** (`mcpTemplates`) configure server instances with dynamic values like:

- <span v-pre>`{{project.path}}`</span> - Project directory path
- <span v-pre>`{{user.username}}`</span> - Current user
- <span v-pre>`{{context.sessionId}}`</span> - Connection session

**Instruction Templates** customize LLM instructions with variables like:

- <span v-pre>`{{serverCount}}`</span> - Number of connected servers
- <span v-pre>`{{serverNames}}`</span> - List of server names

## Quick Start

### Basic Template Example

Add a template to your `mcp.json`:

::: v-pre

```json
{
  "mcpTemplates": {
    "project-context": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{project.path}}"],
      "tags": ["filesystem", "project"]
    }
  }
}
```

:::

When a client connects, 1MCP:

1. Collects context (project path, user, environment)
2. Renders the template with actual values
3. Creates a server instance with the rendered configuration
4. Connects the client to the new instance

### Environment-Specific Configuration

::: v-pre

```json
{
  "mcpTemplates": {
    "conditional-server": {
      "command": "node",
      "args": ["{{project.path}}/server.js"],
      "env": {
        "NODE_ENV": "{{project.environment}}",
        "DEBUG": "{{#if (eq project.environment 'development')}}true{{else}}false{{/if}}"
      },
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}",
      "tags": ["development"]
    }
  }
}
```

:::

## Template Variables

Templates have access to four namespaces of context variables:

### Project Variables (`project.*`)

| Variable                 | Type    | Description                      | Example                        |
| ------------------------ | ------- | -------------------------------- | ------------------------------ |
| `project.path`           | string  | Absolute path to current project | `/Users/dev/myapp`             |
| `project.name`           | string  | Project directory name           | `myapp`                        |
| `project.environment`    | string  | Environment name                 | `development`                  |
| `project.git.branch`     | string? | Git branch name                  | `main`                         |
| `project.git.commit`     | string? | Git commit hash                  | `a1b2c3d`                      |
| `project.git.repository` | string? | Git remote URL                   | `https://github.com/user/repo` |
| `project.custom.*`       | any     | Custom values from `.1mcprc`     | User-defined                   |

### User Variables (`user.*`)

| Variable        | Type    | Description         | Example            |
| --------------- | ------- | ------------------- | ------------------ |
| `user.username` | string? | System username     | `developer`        |
| `user.name`     | string? | User's full name    | `Jane Developer`   |
| `user.email`    | string? | User email          | `jane@example.com` |
| `user.home`     | string? | Home directory path | `/Users/developer` |
| `user.uid`      | string? | User ID             | `501`              |
| `user.gid`      | string? | Group ID            | `20`               |
| `user.shell`    | string? | Default shell       | `/bin/zsh`         |

### Context Variables (`context.*`)

| Variable            | Type   | Description                  | Example                |
| ------------------- | ------ | ---------------------------- | ---------------------- |
| `context.path`      | string | Working directory path       | `/Users/dev/myapp`     |
| `context.timestamp` | string | ISO 8601 timestamp           | `2025-01-25T10:30:00Z` |
| `context.sessionId` | string | Unique connection session ID | `sess_abc123`          |
| `context.version`   | string | 1MCP version                 | `0.29.0`               |

### Transport Variables (`transport.*`)

| Variable                        | Type    | Description             | Example                 |
| ------------------------------- | ------- | ----------------------- | ----------------------- |
| `transport.type`                | string  | Transport protocol      | `http`, `sse`, `stdio`  |
| `transport.url`                 | string? | Server URL (HTTP/SSE)   | `http://localhost:3050` |
| `transport.connectionId`        | string? | Connection identifier   | `conn_xyz789`           |
| `transport.connectionTimestamp` | string? | Connection time         | `2025-01-25T10:30:00Z`  |
| `transport.client.name`         | string  | Client application name | `cursor`, `claude-code` |
| `transport.client.version`      | string  | Client version          | `1.0.0`                 |
| `transport.client.title`        | string? | Client display name     | `Cursor Editor`         |

## Template Syntax

1MCP uses [Handlebars](https://handlebarsjs.com/) for template rendering. Variables use double curly braces: <span v-pre>`{{variable}}`</span>.

### Variable Access

::: v-pre

```text
{{project.path}}              <!-- /Users/dev/project -->
{{user.username}}             <!-- developer -->
{{context.sessionId}}         <!-- sess_abc123 -->
{{transport.client.name}}     <!-- cursor -->
{{project.custom.teamId}}     <!-- Custom value from .1mcprc -->
```

:::

### Conditionals

::: v-pre
Use `{{#if}}` for conditional logic:

```

{{#if (eq project.environment 'production')}}
  <!-- Production configuration -->
{{else}}
  <!-- Development configuration -->
{{/if}}
```

:::

### Comparisons

Use built-in helpers for comparisons:

::: v-pre

```text
{{#if (eq project.environment 'development')}}{{/if}}
{{#if (ne user.username 'root')}}{{/if}}
{{#if (gt project.custom.count 5)}}{{/if}}
{{#if (lt transport.client.version '2.0')}}{{/if}}
```

:::

### Logical Operators

Combine conditions with `and`/`or`:

::: v-pre

```text
{{#if (and (eq project.environment 'production') (eq project.custom.region 'us'))}}
{{/if}}

{{#if (or (eq project.custom.team 'backend') (eq project.custom.team 'devops'))}}
{{/if}}
```

:::

### String Operations

::: v-pre

```text
{{#if (contains project.name 'admin')}}
{{/if}}

{{#if (startsWith project.git.branch 'feature/')}}
{{/if}}

{{#if (endsWith project.name '-test')}}
{{/if}}
```

:::

## Context Enrichment (.1mcprc)

Project-level context enrichment allows you to inject custom metadata into templates. Create a `.1mcprc` file in your project root:

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
      "debugMode": true,
      "apiEndpoint": "https://dev-api.example.com"
    },
    "envPrefixes": ["MYAPP_*", "TEAM_*"],
    "includeGit": true,
    "sanitizePaths": true
  }
}
```

### Context Fields

| Field                   | Type             | Description                                         |
| ----------------------- | ---------------- | --------------------------------------------------- |
| `preset`                | string           | Default preset to use                               |
| `tags`                  | string\|string[] | Default tags for filtering                          |
| `context.projectId`     | string           | Project identifier                                  |
| `context.environment`   | string           | Environment name (development, staging, production) |
| `context.team`          | string           | Team name                                           |
| `context.custom`        | object           | Custom key-value pairs                              |
| `context.envPrefixes`   | string[]         | Environment variable prefixes to include            |
| `context.includeGit`    | boolean          | Include Git information                             |
| `context.sanitizePaths` | boolean          | Sanitize file paths for security                    |

### Accessing Custom Context

Custom values are available as <span v-pre>`{{project.custom.*}}`</span>:

::: v-pre

```json
{
  "mcpTemplates": {
    "team-server": {
      "command": "npx",
      "args": ["-y", "serena", "{{project.path}}"],
      "env": {
        "TEAM_ID": "{{project.custom.teamId}}",
        "REGION": "{{project.custom.region}}",
        "API_ENDPOINT": "{{project.custom.apiEndpoint}}",
        "DEBUG": "{{#if project.custom.debugMode}}true{{else}}false{{/if}}"
      },
      "tags": ["{{project.custom.team}}"]
    }
  }
}
```

:::

## Complete Example

Here's a comprehensive template configuration:

::: v-pre

```json
{
  "$schema": "https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json",
  "version": "1.0.0",
  "templateSettings": {
    "validateOnReload": true,
    "failureMode": "graceful",
    "cacheContext": true
  },
  "mcpTemplates": {
    "project-filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{project.path}}"],
      "tags": ["filesystem", "project-local"],
      "disabled": "{{#if (eq transport.client.name 'claude-code')}}false{{else}}true{{/if}}"
    },
    "team-serena": {
      "command": "npx",
      "args": [
        "-y",
        "serena",
        "{{project.path}}",
        "--team",
        "{{project.custom.team}}",
        "--env",
        "{{project.environment}}"
      ],
      "env": {
        "PROJECT_ID": "{{project.custom.projectId}}",
        "SESSION_ID": "{{context.sessionId}}",
        "GIT_BRANCH": "{{project.git.branch}}",
        "API_ENDPOINT": "{{project.custom.apiEndpoint}}"
      },
      "cwd": "{{project.path}}",
      "tags": ["filesystem", "search", "{{project.custom.team}}"]
    },
    "conditional-debug-server": {
      "command": "node",
      "args": ["{{project.path}}/debug-server.js"],
      "cwd": "{{project.path}}",
      "env": {
        "NODE_ENV": "{{project.environment}}",
        "DEBUG": "{{#if (eq project.environment 'development')}}true{{else}}false{{/if}}",
        "LOG_LEVEL": "{{#if (eq project.environment 'production')}}warn{{else}}debug{{/if}}"
      },
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}",
      "tags": ["debug", "development"]
    },
    "client-aware-server": {
      "command": "npx",
      "args": [
        "-y",
        "my-custom-server",
        "--client",
        "{{transport.client.name}}",
        "--version",
        "{{transport.client.version}}"
      ],
      "env": {
        "CLIENT_NAME": "{{transport.client.name}}",
        "CLIENT_VERSION": "{{transport.client.version}}",
        "CONNECTION_ID": "{{transport.connectionId}}",
        "USER": "{{user.username}}"
      },
      "tags": ["client-aware", "custom"]
    }
  }
}
```

:::

## Template Settings

Control template processing behavior with `templateSettings`:

```json
{
  "templateSettings": {
    "validateOnReload": true,
    "failureMode": "graceful",
    "cacheContext": true
  }
}
```

| Setting            | Type                   | Default    | Description                                |
| ------------------ | ---------------------- | ---------- | ------------------------------------------ |
| `validateOnReload` | boolean                | `false`    | Validate templates when config is reloaded |
| `failureMode`      | `'strict'\|'graceful'` | `'strict'` | How to handle template errors              |
| `cacheContext`     | boolean                | `true`     | Cache rendered templates by context hash   |

### Failure Modes

- **`strict`**: Template errors prevent server startup
- **`graceful`**: Template errors are logged, original template used as fallback

## Conditional Disable

Templates can be conditionally disabled using the `disabled` field:

::: v-pre

```json
{
  "mcpTemplates": {
    "dev-only-server": {
      "command": "node",
      "args": ["dev-tools.js"],
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}",
      "tags": ["development"]
    },
    "client-specific": {
      "command": "npx",
      "args": ["-y", "special-server"],
      "disabled": "{{#if (eq transport.client.name 'cursor')}}false{{else}}true{{/if}}",
      "tags": ["cursor-only"]
    },
    "user-restricted": {
      "command": "npx",
      "args": ["-y", "admin-tools"],
      "disabled": "{{#if (contains user.username 'admin')}}false{{else}}true{{/if}}",
      "tags": ["admin"]
    }
  }
}
```

:::

The `disabled` field evaluates the template and converts the result to a boolean:

- `"true"`, `"1"`, `"yes"` → `true` (disabled)
- `"false"`, `"0"`, `"no"` or empty → `false` (enabled)

## Handlebars Helpers

1MCP includes several built-in Handlebars helpers:

### Math Helpers

::: v-pre

```text
{{math value1 '+' value2}}           <!-- Addition -->
{{math value1 '-' value2}}           <!-- Subtraction -->
{{math value1 '*' value2}}           <!-- Multiplication -->
{{math value1 '/' value2}}           <!-- Division -->
{{math value1 '%' value2}}           <!-- Modulo -->
{{math value1 '**' value2}}          <!-- Exponentiation -->
{{math value '/' 100 '*' 100}}       <!-- Chained operations (rounded)
```

:::

### Comparison Helpers

::: v-pre

```text
{{eq a b}}     <!-- Equal -->
{{ne a b}}     <!-- Not equal -->
{{gt a b}}     <!-- Greater than -->
{{lt a b}}     <!-- Less than -->
```

:::

### Logical Helpers

::: v-pre

```text
{{and a b c}}  <!-- All truthy -->
{{or a b c}}   <!-- Any truthy -->
```

:::

### String Helpers

::: v-pre

```text
{{contains str substring}}     <!-- Contains substring -->
{{startsWith str prefix}}      <!-- Starts with prefix -->
{{endsWith str suffix}}        <!-- Ends with suffix -->
{{len str}}                    <!-- String length -->
{{substring str start end}}    <!-- Extract substring -->
```

:::

### Math Operation Helpers

::: v-pre

```text
{{subtract a b}}    <!-- a - b with null safety -->
{{div a b}}         <!-- a / b with zero safety -->
```

:::

## Best Practices

### 1. Use .1mcprc for Project Context

Store project-specific metadata in `.1mcprc` rather than hardcoding in templates:

**Good** (`.1mcprc`):

```json
{
  "context": {
    "projectId": "myapp-api",
    "team": "platform",
    "custom": {
      "apiEndpoint": "https://api.example.com"
    }
  }
}
```

**Avoid** (hardcoded):

```json
{
  "mcpTemplates": {
    "api-server": {
      "env": {
        "API_ENDPOINT": "https://api.example.com"
      }
    }
  }
}
```

### 2. Make Templates Environment-Aware

Use `project.environment` for environment-specific behavior:

::: v-pre

```json
{
  "mcpTemplates": {
    "smart-server": {
      "env": {
        "LOG_LEVEL": "{{#if (eq project.environment 'production')}}warn{{else}}debug{{/if}}",
        "CACHE_ENABLED": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}"
      }
    }
  }
}
```

:::

### 3. Validate with `validateOnReload`

Enable template validation during development:

```json
{
  "templateSettings": {
    "validateOnReload": true,
    "failureMode": "strict"
  }
}
```

### 4. Use Graceful Failure in Production

Prevent template errors from breaking production:

```json
{
  "templateSettings": {
    "validateOnReload": false,
    "failureMode": "graceful"
  }
}
```

### 5. Tag Templates Appropriately

Use dynamic tags for better filtering:

::: v-pre

```json
{
  "mcpTemplates": {
    "team-server": {
      "tags": ["team-{{project.custom.team}}", "{{project.environment}}", "region-{{project.custom.region}}"]
    }
  }
}
```

:::

## Troubleshooting

### Template Not Rendering

**Symptom**: Template variables appear as literal <span v-pre>`{{variable}}`</span> strings

**Solutions**:

1. Ensure templates are in `mcpTemplates`, not `mcpServers`
2. Check that context is being collected (enable debug logging)
3. Verify variable names match the context structure

### Custom Context Missing

**Symptom**: <span v-pre>`{{project.custom.*}}`</span> variables are undefined

**Solutions**:

1. Check `.1mcprc` file exists in project root
2. Validate JSON syntax in `.1mcprc`
3. Ensure `context.custom` object is properly structured

### Server Not Starting

**Symptom**: Template server fails to start

**Solutions**:

1. Check rendered configuration in logs
2. Verify command path after template rendering
3. Ensure environment variables are properly quoted

### Conditional Logic Not Working

::: v-pre

**Symptom**: `{{#if}}` conditions not evaluating as expected

**Solutions**:

1. Use comparison helpers: `{{#if (eq var 'value')}}`
2. Check for whitespace in values
3. Enable debug logging to see actual values

:::

## See Also

- **[Template Syntax Reference](/reference/mcp-templates/syntax)** - Complete syntax and helper reference
- **[Custom Instructions Template](/guide/custom-instructions-template)** - Customize LLM instructions (different feature)
- **[Context Collection](/guide/advanced/server-filtering)** - How context is collected
- **[Server Filtering](/guide/advanced/server-filtering)** - Tag-based filtering
