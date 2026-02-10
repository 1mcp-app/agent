---
title: Serena Integration - Semantic Code Analysis with MCP Templates
description: Learn how to use Serena (semantic code analysis MCP server) with 1MCP's template system for dynamic, project-aware semantic code understanding.
head:
  - ['meta', { name: 'keywords', content: 'Serena,semantic analysis,MCP templates,code analysis,LSP,symbol analysis' }]
  - ['meta', { property: 'og:title', content: 'Serena Integration with 1MCP Templates' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Configure Serena semantic code analysis with 1MCP templates for project-aware, context-driven workflows.',
      },
    ]
---

# Serena Integration

> **🧠 Semantic Intelligence**: Leverage Serena's powerful semantic code analysis with 1MCP's dynamic template system for project-aware workflows

## Overview

[Serena](https://github.com/oraios/serena) is a semantic code analysis toolkit that provides LSP-powered understanding of your codebase. It offers symbol-level operations, cross-reference analysis, and intelligent code navigation across 30+ programming languages.

### Why Use Serena with 1MCP Templates?

<ClientOnly>

Combining Serena with 1MCP's template system enables:

- **Automatic Project Detection**: Templates inject project paths dynamically via <span v-pre>`{{project.path}}`</span>
- **Context-Aware Configuration**: Different tool sets based on client type (IDE vs CLI)
- **Environment-Based Control**: Enable semantic analysis in development, disable in production
- **Zero Manual Configuration**: Project context flows automatically from 1MCP to Serena

</ClientOnly>

### Key Capabilities

- **Symbol-Level Operations**: Find, reference, rename, and manipulate code symbols
- **Multi-Language Support**: Python, TypeScript, Java, Rust, Go, C/C++, and 30+ more
- **LSP-Powered Analysis**: Leverages Language Server Protocol for accurate understanding
- **Project Indexing**: Fast symbol lookup for large codebases
- **Web Dashboard**: Visual project exploration at `http://localhost:24282/dashboard`

## Quick Start

### Basic Static Configuration

Add Serena to your `mcp.json` with a fixed project path:

::: v-pre

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "/absolute/path/to/your/project",
        "--context",
        "claude-code"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

### Template-Based Configuration (Recommended)

Use templates for automatic project detection:

::: v-pre

```json
{
  "mcpTemplates": {
    "project-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "claude-code"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**How it works**: When a client connects, 1MCP automatically:

1. Detects the current project directory
2. Renders <span v-pre>`{{project.path}}`</span> with the actual path
3. Launches Serena configured for that specific project
4. Provides project-aware semantic analysis tools

## Template Variables

### Project Path Injection

<ClientOnly>

Serena requires a project root directory for analysis. Use <span v-pre>`{{project.path}}`</span> to inject this automatically:

::: v-pre

```json
{
  "mcpTemplates": {
    "auto-project-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}"
      ]
    }
  }
}
```

:::

</ClientOnly>

### Instance Sharing

**Important**: 1MCP automatically shares the same Serena instance when the rendered template configuration is identical. This means:

- Multiple AI clients/sessions **on the same machine** working on the **same project** with the **same context** share one Serena instance
- Each unique project path gets its own dedicated Serena instance
- Different contexts (e.g., `claude-code` vs `ide`) get separate instances

**Example**: If you open multiple terminal windows on your development machine running Claude Code CLI, all connected to the same project, they share one Serena instance with the `claude-code` context. If you then open Cursor (also on the same machine) for the same project, it gets a separate instance with `ide` context.

**Note**: Serena requires local file access to read code, configuration, and cache files. Each developer on their own machine will have their own Serena instance, even when working on the same project.

**Benefits**:

- **Resource Efficiency**: Reduced memory and CPU usage on your local machine
- **Shared Symbol Index**: Faster analysis after the first AI client connects
- **Consistent State**: All AI clients on the same machine see the same semantic understanding

## Context-Aware Configuration

Serena's `--context` parameter controls which tools are available based on the client type. Use template conditionals to select the appropriate context:

### Available Context Types

| Context       | Use Case             | Tools Available                                      |
| ------------- | -------------------- | ---------------------------------------------------- |
| `claude-code` | Claude Code CLI      | Optimized tool set, disables IDE-redundant features  |
| `ide`         | VSCode, Cursor, IDEs | Reduced tools to avoid duplication with IDE features |
| `codex`       | Codex CLI            | Required for Codex compatibility                     |
| Custom        | User-defined         | Create via Serena's config system                    |

### Client-Aware Context Selection

Automatically choose context based on the connecting client:

::: v-pre

```json
{
  "mcpTemplates": {
    "smart-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "{{#if (eq transport.client.name 'cursor')}}ide{{else}}claude-code{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**How it works**:

- Cursor or VSCode clients get `ide` context (avoids tool duplication)
- All other clients get `claude-code` context (full tool set)

### Multi-Client Context Mapping

Handle multiple IDE clients with complex conditionals:

::: v-pre

```json
{
  "mcpTemplates": {
    "client-aware-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "{{#if (or (eq transport.client.name 'cursor') (eq transport.client.name 'vscode'))}}ide{{else}}claude-code{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

## Project-Level Configuration

### Using .1mcprc for Custom Context

Define custom metadata in `.1mcprc` and reference it in templates:

**.1mcprc in your project root:**

::: v-pre

```json
{
  "preset": "dev-tools",
  "tags": ["backend", "python"],
  "context": {
    "projectId": "myapp-backend",
    "environment": "development",
    "custom": {
      "serenaContext": "claude-code",
      "enableDashboard": true
    }
  }
}
```

:::

**Template using custom context:**

::: v-pre

```json
{
  "mcpTemplates": {
    "custom-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "{{project.custom.serenaContext}}",
        "--open-web-dashboard",
        "{{project.custom.enableDashboard}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

### Serena's Own Configuration

Serena maintains its own configuration separate from 1MCP templates:

- **Global config**: `~/.serena/serena_config.yml`
- **Project config**: `.serena/project.yml` (created via `serena project create`)

**Setting up Serena project config:**

```bash
# Navigate to your project
cd /path/to/your/project

# Initialize Serena project with indexing
serena project create --index

# This creates .serena/project.yml with project-specific settings
```

**Important**: 1MCP templates configure the Serena server instance (CLI arguments), while Serena's config files control analysis behavior (indexing preferences, language settings).

## Complete Examples

### Example 1: Multi-Environment Setup

Enable semantic analysis in development, disable in production:

::: v-pre

```json
{
  "mcpTemplates": {
    "env-aware-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "claude-code"
      ],
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}",
      "tags": ["filesystem", "search", "semantic", "development"]
    }
  }
}
```

:::

**Use case**: Prevent resource-intensive semantic analysis in production environments while keeping it available for development.

### Example 2: Dashboard Control

Control web dashboard based on environment:

::: v-pre

```json
{
  "mcpTemplates": {
    "dashboard-controlled-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "claude-code",
        "--open-web-dashboard",
        "{{#if (eq project.environment 'development')}}true{{else}}false{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**Use case**: Auto-launch the web dashboard in development for visual exploration, but disable it in CI/CD or production.

### Example 3: Language Backend Selection

Use JetBrains language backend for specific projects:

::: v-pre

```json
{
  "mcpTemplates": {
    "jetbrains-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "{{#if (eq transport.client.name 'cursor')}}ide{{else}}claude-code{{/if}}",
        "--language-backend",
        "{{#if project.custom.useJetBrains}}JetBrains{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**Use case**: Advanced projects can opt into JetBrains plugin-based language support via custom metadata.

### Example 4: HTTP Transport with Custom Port

Run Serena over HTTP for remote access:

::: v-pre

```json
{
  "mcpTemplates": {
    "http-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "claude-code",
        "--transport",
        "streamable-http",
        "--port",
        "{{#if project.custom.serenaPort}}{{project.custom.serenaPort}}{{else}}24283{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**Use case**: Remote access scenarios or when you need to expose Serena over HTTP instead of STDIO.

## Best Practices

<ClientOnly>

### 1. Use `--project` with Templates

Always inject project path dynamically:

✅ **Good**:
::: v-pre

```json
"args": ["serena", "start-mcp-server", "--project", "{{project.path}}"]
```

:::

❌ **Bad**:

::: v-pre

```json
"args": ["serena", "start-mcp-server", "--project", "/hardcoded/path"]
```

:::

</ClientOnly>

### 2. Choose the Correct Context

Match context to your client type:

| Client Type     | Recommended Context   |
| --------------- | --------------------- |
| Claude Code CLI | `claude-code`         |
| Cursor, VSCode  | `ide`                 |
| Codex CLI       | `codex`               |
| Custom agent    | Create custom context |

### 3. Tag Appropriately

Always include semantic analysis tags:

::: v-pre

```json
{
  "tags": ["filesystem", "search", "semantic"]
}
```

:::

This enables proper server filtering with presets.

<ClientOnly>

### 4. No Environment Variables

**Important**: Serena does NOT use environment variables for configuration. All settings must be passed via:

- CLI arguments (e.g., `--project`, `--context`)
- Configuration files (`serena_config.yml`, `.serena/project.yml`)

❌ **Wrong**:

::: v-pre

```json
{
  "env": {
    "SERENA_PROJECT": "{{project.path}}" // Serena ignores this
  }
}
```

:::

✅ **Correct**:

::: v-pre

```json
{
  "args": ["--project", "{{project.path}}"] // Use CLI args
}
```

:::

</ClientOnly>

### 5. Environment-Based Disabling

<ClientOnly>

Use the `disabled` field to control Serena per environment:

::: v-pre

```json
{
  "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}"
}
```

:::

</ClientOnly>

### 6. Project Setup

For optimal performance, initialize Serena in your project:

```bash
cd /path/to/your/project
serena project create --index
```

This creates `.serena/project.yml` and builds the initial symbol index.

### 7. Client-Aware Selection

<ClientOnly>

Leverage <span v-pre>`{{transport.client.name}}`</span> for intelligent context selection:

::: v-pre

```json
{
  "args": ["--context", "{{#if (eq transport.client.name 'cursor')}}ide{{else}}claude-code{{/if}}"]
}
```

:::

</ClientOnly>

## Serena-Specific Features

### Symbol-Level Operations

Serena provides powerful semantic tools:

- **`find_symbol`**: Locate classes, functions, methods by name or pattern
- **`find_referencing_symbols`**: Find all references to a symbol
- **`get_symbols_overview`**: Get high-level code structure
- **`replace_symbol_body`**: Modify symbol definitions
- **`insert_after_symbol`**: Add code after symbols
- **`insert_before_symbol`**: Add code before symbols
- **`rename_symbol`**: Rename symbols across the codebase

### Language Support

Serena supports 30+ languages via LSP, including:

- **Web**: TypeScript, JavaScript, HTML, CSS
- **Backend**: Python, Java, Go, Rust, C/C++, C#
- **Mobile**: Swift, Kotlin, Dart
- **Data**: SQL, R, Julia
- **Config**: YAML, JSON, TOML

### Project Indexing

For large projects, build an index for faster symbol lookup:

```bash
# One-time indexing
serena project index

# Or during project creation
serena project create --index
```

### Web Dashboard

Serena auto-launches a web dashboard at `http://localhost:24282/dashboard` for visual code exploration.

**Disable the dashboard**:

::: v-pre

```json
{
  "args": ["--open-web-dashboard", "false"]
}
```

:::

### Context System

Different contexts provide different tool sets:

- **`claude-code`**: Full semantic toolkit for CLI agents
- **`ide`**: Minimal tools to avoid IDE duplication
- **`codex`**: Codex-compatible tool configuration

Create custom contexts via `~/.serena/serena_config.yml`.

## Troubleshooting

<ClientOnly>

### Template Variables Not Rendering

**Symptom**: Serena starts with literal `{{project.path}}` instead of actual path

**Solution**: Ensure you're using `mcpTemplates`, not `mcpServers`:

::: v-pre

```json
{
  "mcpTemplates": {  // ← Must be templates, not servers
    "serena": { ... }
  }
}
```

:::

### Serena Not Finding Project Root

**Symptom**: Serena reports "Project not found" or "Invalid project path"

**Solutions**:

1. Use `--project-from-cwd` if your agent starts in the project directory
2. Verify <span v-pre>`{{project.path}}`</span> resolves correctly
3. Initialize project: `serena project create` in your project root

</ClientOnly>

### Context Parameter Not Working

**Symptom**: Wrong tools available or context parameter ignored

**Solutions**:

1. Verify context name is valid: `claude-code`, `ide`, `codex`, or custom
2. Check for typos in template conditional logic
3. Ensure custom contexts are defined in `~/.serena/serena_config.yml`

### Performance Issues with Large Projects

**Symptoms**: Slow symbol lookup, high memory usage

**Solutions**:

1. Build symbol index: `serena project index`
2. Use `.serenignore` to exclude unnecessary directories (node_modules, build, etc.)
3. Consider using `--language-backend JetBrains` for better performance on large codebases

### Dashboard Not Opening

**Symptom**: Web dashboard doesn't launch automatically

**Solutions**:

1. Check if port 24282 is already in use
2. Manually open: `http://localhost:24282/dashboard`
3. Disable auto-launch: `--open-web-dashboard false`

## See Also

- [MCP Server Templates Guide](/guide/mcp-server-templates) - Complete guide to template system
- [Template Syntax Reference](/reference/mcp-templates/syntax) - Handlebars syntax and helpers
- [Configuration Guide](/guide/essentials/configuration) - Configuration and .1mcprc setup
- [Claude Desktop Integration](/guide/integrations/claude-desktop) - Using Serena with Claude Desktop
- [Developer Tools](/guide/integrations/developer-tools) - Integration capabilities and APIs
- [Serena Documentation](https://oraios.github.io/serena/) - Official Serena docs
- [Serena GitHub](https://github.com/oraios/serena) - Source code and issues
