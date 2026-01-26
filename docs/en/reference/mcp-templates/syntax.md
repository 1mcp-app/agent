---
title: MCP Template Syntax Reference
description: Complete reference for Handlebars template syntax in 1MCP server templates. Variables, helpers, and rendering rules.
head:
  - ['meta', { name: 'keywords', content: 'Handlebars syntax,template reference,variables,helpers' }]
  - ['meta', { property: 'og:title', content: '1MCP Template Syntax Reference' }]
  - ['meta', { property: 'og:description', content: 'Complete Handlebars syntax reference for 1MCP server templates.' }]
---

# Template Syntax Reference

Complete reference for Handlebars template syntax in 1MCP server templates.

## Syntax Overview

1MCP server templates use [Handlebars](https://handlebarsjs.com/) syntax with double curly braces for variable substitution:

::: v-pre

```text
{{variable}}           <!-- Variable access -->
{{namespace.variable}}  <!-- Nested variable access -->
{{helper arg1 arg2}}   <!-- Helper invocation -->
```

:::

## Variable Access

### Standard Syntax

All template variables use double curly braces:

::: v-pre

```text
{{project.path}}
{{user.username}}
{{context.sessionId}}
{{transport.client.name}}
{{project.custom.teamId}}
```

:::

### Nested Properties

Access nested properties using dot notation:

::: v-pre

```text
{{project.git.branch}}
{{project.custom.apiEndpoint}}
{{transport.client.version}}
```

:::

### Optional Values

Properties that may be undefined will render as empty strings:

::: v-pre

```text
{{project.git.branch}}    <!-- Renders empty if not in git repo -->
{{user.email}}            <!-- Renders empty if not set -->
```

:::

## Template Variables

### Project Variables

| Variable                 | Type    | Description                           |
| ------------------------ | ------- | ------------------------------------- |
| `project.path`           | string  | Absolute path to current project      |
| `project.name`           | string  | Project directory name                |
| `project.environment`    | string  | Environment from `.1mcprc` or default |
| `project.git.branch`     | string? | Current git branch                    |
| `project.git.commit`     | string? | Current git commit hash               |
| `project.git.repository` | string? | Git remote URL                        |
| `project.custom.*`       | any     | Custom values from `.1mcprc`          |

### User Variables

| Variable        | Type    | Description         |
| --------------- | ------- | ------------------- |
| `user.username` | string? | System username     |
| `user.name`     | string? | User's full name    |
| `user.email`    | string? | User email address  |
| `user.home`     | string? | Home directory path |
| `user.uid`      | string? | User ID             |
| `user.gid`      | string? | Group ID            |
| `user.shell`    | string? | Default shell path  |

### Context Variables

| Variable            | Type   | Description                  |
| ------------------- | ------ | ---------------------------- |
| `context.path`      | string | Current working directory    |
| `context.timestamp` | string | ISO 8601 timestamp           |
| `context.sessionId` | string | Unique connection session ID |
| `context.version`   | string | 1MCP version                 |

### Transport Variables

| Variable                        | Type    | Description                             |
| ------------------------------- | ------- | --------------------------------------- |
| `transport.type`                | string  | Transport type (`http`, `sse`, `stdio`) |
| `transport.url`                 | string? | Server URL (HTTP/SSE only)              |
| `transport.connectionId`        | string? | Connection identifier                   |
| `transport.connectionTimestamp` | string? | Connection time (ISO 8601)              |
| `transport.client.name`         | string  | Client application name                 |
| `transport.client.version`      | string  | Client application version              |
| `transport.client.title`        | string? | Client display name                     |

## Conditional Expressions

### If/Else

::: v-pre

```text
{{#if (eq project.environment 'production')}}
  production-value
{{else if (eq project.environment 'staging')}}
  staging-value
{{else}}
  development-value
{{/if}}
```

:::

### Unless

::: v-pre

```text
{{#unless (eq transport.client.name 'claude-code')}}
  This content is hidden for claude-code
{{/unless}}
```

:::

## Comparison Helpers

### Equal (`eq`)

::: v-pre

```text
{{#if (eq project.environment 'production')}}
{{/if}}
```

:::

### Not Equal (`ne`)

::: v-pre

```text
{{#if (ne user.username 'root')}}
{{/if}}
```

:::

### Greater Than (`gt`)

::: v-pre

```text
{{#if (gt project.custom.count 5)}}
{{/if}}
```

:::

### Less Than (`lt`)

::: v-pre

```text
{{#if (lt project.custom.maxConnections 10)}}
{{/if}}
```

:::

## Logical Helpers

### And

::: v-pre

```text
{{#if (and (eq project.environment 'production') (eq project.custom.region 'us'))}}
{{/if}}
```

:::

### Or

::: v-pre

```text
{{#if (or (eq project.custom.team 'backend') (eq project.custom.team 'devops'))}}
{{/if}}
```

:::

## Math Helpers

### Basic Math

::: v-pre

```text
{{math value1 '+' value2}}     <!-- Addition -->
{{math value1 '-' value2}}     <!-- Subtraction -->
{{math value1 '*' value2}}     <!-- Multiplication -->
{{math value1 '/' value2}}     <!-- Division -->
{{math value1 '%' value2}}     <!-- Modulo -->
{{math value1 '**' value2}}    <!-- Exponentiation -->
```

:::

### Chained Operations

::: v-pre

```text
{{math value '*' 100 '/' total}}    <!-- (value * 100) / total, rounded -->
```

:::

### Specialized Math

::: v-pre

```text
{{subtract a b}}    <!-- a - b with null safety, returns 0 if undefined -->
{{div a b}}         <!-- a / b with zero safety, returns 0 if dividing by zero -->
```

:::

## String Helpers

### Contains

::: v-pre

```text
{{#if (contains project.name 'admin')}}
  Contains 'admin'
{{/if}}
```

:::

### Starts With

::: v-pre

```text
{{#if (startsWith project.git.branch 'feature/'))}}
  Feature branch
{{/if}}
```

:::

### Ends With

::: v-pre

```text
{{#if (endsWith project.name '-test'))}}
  Test project
{{/if}}
```

:::

### Length

::: v-pre

```text
{{len project.name}}    <!-- String length -->
```

:::

### Substring

::: v-pre

```text
{{substring project.name 0 5}}    <!-- Characters 0-4 -->
{{substring project.name 3}}      <!-- From character 3 to end -->
```

:::

## Context Data Structure

### TypeScript Interfaces

```typescript
interface ContextData {
  project: {
    path: string;
    name: string;
    environment?: string;
    git?: {
      branch?: string;
      commit?: string;
      repository?: string;
    };
    custom?: Record<string, unknown>;
  };
  user: {
    username?: string;
    name?: string;
    email?: string;
    home?: string;
    uid?: string;
    gid?: string;
    shell?: string;
  };
  context: {
    path: string;
    timestamp: string;
    sessionId: string;
    version: string;
  };
  transport?: {
    type: string;
    url?: string;
    connectionId?: string;
    connectionTimestamp?: string;
    client?: {
      name: string;
      version: string;
      title?: string;
    };
  };
}
```

## Template Rendering Process

1MCP processes templates through a five-step workflow:

### Step 1: Context Collection

When a client connects, 1MCP collects context from:

- Current working directory (project path, name)
- Git repository (branch, commit, remote)
- `.1mcprc` file (custom context, environment)
- System information (user details)
- Connection details (transport, client info)

### Step 2: Template Lookup

1MCP looks up templates from `mcpTemplates` in `mcp.json` that match the client's filter criteria (tags, preset).

### Step 3: Variable Substitution

::: v-pre

Each template configuration is rendered by substituting:

- `{{variable}}` placeholders with actual values
- `{{#if}}` conditionals are evaluated
- `{{helper}}` functions are executed

:::

### Step 4: Validation

If `validateOnReload` is enabled, the rendered configuration is validated against the MCP server schema.

### Step 5: Server Creation

A server instance is created using the rendered configuration and connected to the client.

### Caching

When `cacheContext` is enabled (default), rendered templates are cached by context hash to avoid reprocessing identical contexts.

## Error Handling

### Template Syntax Errors

If a template has invalid Handlebars syntax:

- **strict mode**: Server startup fails, error is logged
- **graceful mode**: Original template is used without rendering, error is logged

### Missing Variables

::: v-pre

Variables that don't exist in the context render as empty strings. This is expected behavior for optional values like `{{project.git.branch}}`.

:::

### Validation Errors

If the rendered configuration fails validation:

- **strict mode**: Template server is not created
- **graceful mode**: Original template configuration is used

## Examples

### Environment-Specific Configuration

::: v-pre

```json
{
  "mcpTemplates": {
    "adaptive-server": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "NODE_ENV": "{{project.environment}}",
        "LOG_LEVEL": "{{#if (eq project.environment 'production')}}warn{{else}}debug{{/if}}",
        "FEATURE_FLAG_X": "{{#if (gt project.custom.version 2)}}true{{else}}false{{/if}}"
      }
    }
  }
}
```

:::

### Client-Aware Configuration

::: v-pre

```json
{
  "mcpTemplates": {
    "client-specific": {
      "command": "npx",
      "args": ["-y", "my-server", "--client", "{{transport.client.name}}", "--version", "{{transport.client.version}}"],
      "disabled": "{{#if (or (eq transport.client.name 'cursor') (eq transport.client.name 'claude-code'))}}false{{else}}true{{/if}}"
    }
  }
}
```

:::

### Git-Aware Configuration

::: v-pre

```json
{
  "mcpTemplates": {
    "branch-aware": {
      "command": "npx",
      "args": ["-y", "context-server", "{{project.path}}", "--branch", "{{project.git.branch}}"],
      "disabled": "{{#if (startsWith project.git.branch 'hotfix/')}}true{{else}}false{{/if}}"
    }
  }
}
```

:::

## See Also

- **[MCP Server Templates Guide](/guide/mcp-server-templates)** - Complete guide to using templates
- **[Handlebars Documentation](https://handlebarsjs.com/)** - Official Handlebars reference
- **[Context Enrichment](/guide/mcp-server-templates#context-enrichment-1mcprc)** - Using `.1mcprc` files
