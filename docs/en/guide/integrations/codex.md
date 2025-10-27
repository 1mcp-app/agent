---
title: Codex Integration - Setup and Configuration Guide
description: Learn how to integrate 1MCP with Codex. Configure HTTP transport, per-project settings, and advanced MCP server management for Codex.
head:
  - ['meta', { name: 'keywords', content: 'Codex integration,MCP setup,HTTP transport,per-project configuration' }]
  - ['meta', { property: 'og:title', content: '1MCP Codex Integration Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete guide to integrating 1MCP with Codex. HTTP transport and per-project configuration.',
      },
    ]
---

# Codex Integration

This guide covers integrating 1MCP with Codex to enable advanced MCP server management, per-project configurations, and streamable HTTP transport capabilities.

## Overview

### Codex Version Compatibility

#### Codex < 0.44.0 (Limited Support)

Codex versions before [0.44.0](https://github.com/openai/codex/releases/tag/rust-v0.44.0) have limited MCP server support:

- **No HTTP Transport**: Cannot connect to HTTP/SSE endpoints directly
- **STDIO Only**: Only supports STDIO transport for MCP servers
- **No Per-Project Settings**: Global configuration only, no project-specific server management

#### Codex ≥ 0.44.0 (HTTP Transport Support)

Codex 0.44.0 and later supports HTTP-based MCP servers natively:

- **HTTP Transport**: Can connect directly to HTTP/SSE endpoints
- **Global Configuration**: HTTP servers are configured globally in `config.toml`
- **No Per-Project Settings**: Still lacks project-specific server management

**Note**: Codex per-project configuration is not yet implemented ([see pr#4007 on codex](https://github.com/openai/codex/pull/4007)).

### Why Use 1MCP Proxy Even with Codex ≥ 0.44.0?

While Codex ≥ 0.44.0 can connect directly to HTTP MCP servers, **1MCP proxy is still recommended** for several reasons:

#### 1. **Per-Project Server Management**

```toml
# Direct Codex HTTP (Global - affects all projects)
[mcp_servers.1mcp]
url="http://localhost:3050/mcp"

# vs 1MCP Proxy (Per-project via .1mcprc)
# Project A: {"preset": "web-dev"}      # Only web servers
# Project B: {"preset": "data-science"} # Only data servers
# Project C: {"preset": "backend"}     # Only backend servers
```

#### 2. **Advanced Tag-Based Filtering**

```bash
# 1MCP Proxy: Selective server exposure via presets
npx -y @1mcp/agent preset create web-dev --filter "frontend OR design"
npx -y @1mcp/agent preset create data-science --filter "data-science OR ai"
npx -y @1mcp/agent preset create backend --filter "backend OR api"
```

#### 3. **Centralized Server Management**

- **Single Source**: Manage all MCP servers in one place
- **Hot Reloading**: Update configurations without restarting Codex
- **Team Sharing**: Share presets across team members

### 1MCP Bridge Solution

1MCP provides comprehensive MCP server management through:

- **HTTP ↔ STDIO Proxy**: Translates between HTTP transport and STDIO transport
- **Project-Level Configuration**: Per-project MCP server settings via `.1mcprc` files and presets
- **Advanced Filtering**: Tag-based server selection and filtering
- **Centralized Management**: Unified server lifecycle and capability aggregation

The `.1mcprc` with preset + proxy + serve combination provides different MCP servers for different projects, even with newer Codex versions that support HTTP transport.

## Terminology

To avoid confusion, this guide uses the following terms consistently:

| Term            | Definition                                                                           | Example Command                               |
| --------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| **1MCP Agent**  | The overall npm package `@1mcp/agent` containing all 1MCP functionality              | `npx -y @1mcp/agent --version`                |
| **1MCP Server** | The HTTP server process started with the `serve` command that aggregates MCP servers | `npx -y @1mcp/agent serve`                    |
| **1MCP Proxy**  | The STDIO-to-HTTP bridge started with the `proxy` command for Codex integration      | `npx -y @1mcp/agent proxy`                    |
| **MCP Server**  | Individual Model Context Protocol servers (filesystem, github, etc.)                 | `npx @modelcontextprotocol/server-filesystem` |
| **Preset**      | Named configuration defining which MCP servers to expose via tag filtering           | `npx -y @1mcp/agent preset create my-preset`  |

**Architecture Flow**:

```
Codex (STDIO) ← 1MCP Proxy (STDIO↔HTTP) ← 1MCP Server (HTTP) ← MCP Servers
```

## Alternative: Direct HTTP Transport (Codex ≥ 0.44.0)

For simpler setups, connect Codex directly to 1MCP Server via HTTP:

```bash
1mcp serve  # Start 1MCP server
```

Edit `config.toml`:

```toml
[mcp_servers.1mcp]
url = "http://localhost:3051/mcp"
```

**Limitations**: All servers available globally (no per-project filtering, no tag-based selection). **Use 1MCP Proxy** for project-specific server management and team collaboration.

## Prerequisites

### System Requirements

- **Node.js**: Version 18+ required for MCP servers and 1MCP agent

  ```bash
  node --version  # Should be v18.0.0 or higher
  ```

- **1MCP Agent**: Latest version recommended

  ```bash
  # Install globally for easier use (recommended)
  npm install -g @1mcp/agent

  # Verify installation
  1mcp --version

  # Alternative: Use npx (no installation required)
  npx -y @1mcp/agent --version
  ```

> **Tip**: Installing globally with `npm install -g @1mcp/agent` allows you to use the shorter `1mcp` command instead of `npx -y @1mcp/agent` throughout this guide.

### Installation

If you don't have Codex installed, visit the [official Codex repository](https://github.com/openai/codex) for installation instructions.

### Configuration File Locations

Codex stores its configuration in:

- **Linux/macOS**: `~/.codex/config.toml`
- **Windows**: `%APPDATA%\codex\config.toml`

Create the directory if it doesn't exist:

```bash
mkdir -p ~/.codex  # Linux/macOS
```

### Known Issues

> **⚠️ Important**: Codex 0.44.0's HTTP transport support is experimental. If you experience problems with direct HTTP connections, use the 1MCP proxy method instead. See [Troubleshooting](#troubleshooting) for details.

### Verification Checklist

Before proceeding, verify:

- [ ] Codex version ≥ 0.44.0 installed (or any version for proxy method)
- [ ] Node.js version ≥ 18 installed
- [ ] Can run `1mcp --version` successfully (or `npx -y @1mcp/agent --version`)
- [ ] Configuration directory exists at `~/.codex/`
- [ ] Have a working directory for testing (e.g., `~/test-codex-integration/`)

### Project Directory

You'll need a workspace directory where you want to use the integration. This is where you'll create the `.1mcprc` configuration file.

## Quick Start

### 1. Install and Start 1MCP Server

```bash
# Add some MCP servers with tags for preset filtering
1mcp mcp add filesystem --tags=files,local -- npx -y @modelcontextprotocol/server-filesystem /tmp
1mcp mcp add github --tags=git,remote,collaboration -- npx -y @modelcontextprotocol/server-github

# Start 1MCP server in background
1mcp serve
```

> **Note**: If you haven't installed globally, use `npx -y @1mcp/agent` instead of `1mcp`

### 2. Create Project Configuration

In your Codex project directory, create a `.1mcprc` file:

```json
{
  "preset": "codex-development"
}
```

### 3. Create Preset

```bash
# Create a preset for Codex development using tags
1mcp preset create codex-development --filter "files OR git OR collaboration"
```

**Important**: Presets filter servers by tags. Always tag your servers or they won't be included in presets.

### 4. Configure Codex

Add 1MCP proxy as an MCP server in your Codex configuration:

Edit your Codex `config.toml` file (see [Prerequisites](#prerequisites) for location):

```toml
[mcp_servers.1mcp]
command = "npx"
args = ["-y", "@1mcp/agent@latest", "proxy"]
```

> **Important**:
>
> - The working directory for the 1MCP proxy should be your project directory containing `.1mcprc`
> - Start Codex from your project root to ensure it loads the correct configuration

### 5. Start Codex in your project directory

```bash
cd /path/to/my-project
codex
```

### 6. Test in Codex

```bash
# Test in Codex
/mcp
```

## Architecture

### 1MCP Proxy Integration (Recommended)

```
┌─────────────────┐     STDIO      ┌──────────────────┐      HTTP      ┌─────────────────┐
│      Codex      │ ◄────────────► │    1MCP Proxy    │ ◄────────────► │   1MCP Server   │
│   (any version) │                │   (reads .1mcprc)│                │   (no auth)     │
└─────────────────┘                └──────────────────┘                └─────────────────┘
        │                                   │                                   │
        │                                   │                                   ▼
        │                                   │                          ┌─────────────────┐
        │                                   │                          │   MCP Servers   │
        │                                   │                          │ (filesystem,    │
        ▼                                   ▼                          │  github, db,    │
┌─────────────────┐                ┌──────────────────┐                │  etc.)          │
│ config.toml     │                │ .1mcprc + Preset │                └─────────────────┘
│(MCP server list)│                │ (project config) │                         │
└─────────────────┘                └──────────────────┘                         │
                                                                          Tag-based
                                                                         filtering
```

**Data Flow**:

1. **Codex Configuration**: Add 1MCP proxy as MCP server in `config.toml`
2. **Project Detection**: Proxy reads `.1mcprc` file from current project directory
3. **Preset Loading**: Proxy loads specified preset configuration
4. **Server Connection**: Proxy connects to 1MCP server via HTTP
5. **Tag Filtering**: 1MCP server filters MCP servers based on preset tags
6. **Capability Aggregation**: Filtered servers are exposed to Codex
7. **Bidirectional Communication**: MCP protocol flows through the proxy bridge

### Direct HTTP Integration (Codex ≥ 0.44.0)

```
┌─────────────────┐     HTTP/SSE   ┌──────────────────┐
│      Codex      │ ◄────────────► │   1MCP Server    │
│   (≥ 0.44.0)    │                │   (global config)│
└─────────────────┘                └──────────────────┘
        │                                   │
        ▼                                   ▼
┌─────────────────┐                ┌─────────────────┐
│ config.toml     │                │   MCP Servers   │
│ (HTTP URL only) │                │ (all servers,   │
└─────────────────┘                │  no filtering)  │
                                   └─────────────────┘
```

**Limitations**: No per-project configuration, no tag filtering, global servers only

### Key Differences

| Aspect                 | 1MCP Proxy                       | Direct HTTP                |
| ---------------------- | -------------------------------- | -------------------------- |
| **Per-Project Config** | ✅ `.1mcprc` files               | ❌ Global only             |
| **Server Filtering**   | ✅ Tag-based presets             | ❌ All servers             |
| **Project Isolation**  | ✅ Different servers per project | ❌ Same servers everywhere |
| **Team Sharing**       | ✅ Shareable presets             | ❌ Manual sync             |
| **Setup Complexity**   | ⚠️ Moderate                      | ✅ Simple                  |

## Working Directory Requirements

**Critical**: The 1MCP proxy must be executed from your project directory containing the `.1mcprc` file:

```bash
# ✅ Correct - from project root
cd /path/to/my-project
codex

# ❌ Incorrect - from wrong directory
cd /home/user
codex  # Won't find .1mcprc
```

If using Codex's configuration file approach, ensure the working directory is set correctly in your MCP server configuration or workspace settings.

## Configuration Options

### Basic Project Configuration

Create `.1mcprc` in your project root:

```json
{
  "preset": "development-setup"
}
```

### Advanced Configuration with Filtering

```json
{
  "filter": "web OR api OR filesystem"
}
```

### Multiple Environment Setup

Create different presets for different environments:

**Development (`.1mcprc.dev`)**:

```json
{
  "preset": "dev-environment",
  "filter": "filesystem,web,database,test"
}
```

**Production (`.1mcprc.prod`)**:

```json
{
  "preset": "production",
  "filter": "web,api,database,monitoring"
}
```

Switch between environments:

```bash
# Use development preset
ln -sf .1mcprc.dev .1mcprc

# Use production preset
ln -sf .1mcprc.prod .1mcprc
```

## Preset Management

### Creating Presets

```bash
# Web development preset
npx -y @1mcp/agent preset create web-dev --filter "filesystem,web,api"

# Data science preset
npx -y @1mcp/agent preset create data-science --filter "filesystem,database,python"

# Full-stack preset
npx -y @1mcp/agent preset create full-stack --filter "web,api,database,filesystem"
```

### Listing Presets

```bash
npx -y @1mcp/agent preset list
```

### Using Presets in Projects

Your `.1mcprc` file simply references the preset:

```json
{
  "preset": "web-dev"
}
```

This enables:

- **Team Consistency**: Share presets across team members
- **Easy Switching**: Change environments by updating preset name
- **Centralized Management**: Update servers in one place

## Example: Project-Specific Presets

```bash
# Web development
1mcp mcp add filesystem --tags=files,web -- npx -y @modelcontextprotocol/server-filesystem ./src
1mcp preset create web-dev --filter "files OR git OR web"
echo '{"preset": "web-dev"}' > .1mcprc

# Data science
1mcp mcp add python --tags=python,data -- npx -y @modelcontextprotocol/server-python
1mcp preset create data-science --filter "python OR database OR data"
echo '{"preset": "data-science"}' > .1mcprc

# Team collaboration - different presets per role
1mcp preset create frontend --filter "frontend OR ui OR design"
1mcp preset create backend --filter "backend OR database OR api"
```

## Tags and Presets: Essential Concepts

### Why Tags Matter

Tags are the foundation of 1MCP's filtering system. They enable:

1. **Project-Specific Servers**: Different projects access different MCP servers
2. **Team Collaboration**: Share presets defining which servers teams need
3. **Flexible Grouping**: Group servers by functionality, environment, or team
4. **Security**: Limit access to sensitive servers using tag-based filtering

**Key Principle**: Presets filter MCP servers based on **tags**, not server names.

### Tag Strategy

#### Recommended Tag Categories

| Category          | Examples                                 | Purpose              |
| ----------------- | ---------------------------------------- | -------------------- |
| **Functionality** | `files`, `database`, `api`, `git`        | What the server does |
| **Environment**   | `development`, `production`, `staging`   | Where it's used      |
| **Scope**         | `local`, `remote`, `frontend`, `backend` | Access scope         |
| **Purpose**       | `tools`, `monitoring`, `collaboration`   | Why it's needed      |

### Adding Tags

Use `--tags` parameter before `--` separator:

```bash
1mcp mcp add filesystem --tags=files,local -- npx -y @modelcontextprotocol/server-filesystem ./src
```

### Creating Presets

```bash
1mcp preset create dev-tools --filter "development OR tools"
1mcp preset create backend --filter "backend AND development"
1mcp preset create fullstack --filter "(frontend OR backend) AND development"
```

### Common Mistakes

❌ Missing tags: `1mcp mcp add server -- ...`
✅ Always tag: `1mcp mcp add server --tags=dev,tools -- ...`

❌ Inconsistent: `dev`, `development`, `dev-mode`
✅ Consistent: `development` everywhere

### Debug Commands

```bash
1mcp mcp list                    # View all servers and tags
1mcp preset show my-preset       # See which servers preset includes
1mcp proxy --filter "..."        # Test filter expression
```

### Complex Filter Expressions

```json
{
  "filter": "(filesystem AND development) OR (github AND collaboration)"
}
```

### Exclusion Logic

```json
{
  "filter": "web AND NOT test AND NOT debug"
}
```

## Troubleshooting

**Server not found**: `1mcp mcp status`, `1mcp serve` (without `--enable-auth`), test with `curl http://localhost:3051/mcp`

**Config not loading**: Check `.1mcprc` exists (`ls -la .1mcprc`), validate JSON (`cat .1mcprc | jq`), test with `1mcp proxy`

**Preset not found**: `1mcp preset list`, create it, or use direct filter in `.1mcprc`

**Servers not showing**: `1mcp mcp list`, verify tags match preset filter, check `1mcp preset show <name>`

**Codex connection failed**:

1. Verify proxy works: `1mcp proxy`
2. Check `config.toml` syntax
3. Confirm server running: `curl http://localhost:3051/health`
4. Restart Codex

**Wrong working directory**: Start Codex from project root containing `.1mcprc`

**Tag filtering issues**: Verify servers have tags (`1mcp mcp list`), check preset filter (`1mcp preset show <name>`)

**Preset changes ignored**: Restart Codex and 1MCP server (`pkill -f "1mcp.*serve" && 1mcp serve`)

**Debug**: `1mcp proxy --log-file=proxy.log`, `1mcp mcp status`

**Performance**: Increase timeout with `1mcp proxy --timeout=30000`

## Best Practices

- **Authentication**: Proxy doesn't support auth - use `1mcp serve` without `--enable-auth`
- **Project Structure**: Keep `.1mcprc` in project root, version control it (unless secrets)
- **Tag Consistency**: Use standard tag names across team
- **Performance**: Load only needed servers, use consistent tags for filtering

## Next Steps

**Create More Presets**: `1mcp preset create <name> --filter "<tags>"`

**Team Onboarding**:

- Document setup in project README
- Share `.1mcprc` and preset configs (version control safe if no secrets)
- Standardize tagging conventions

**Optimize**:

- Monitor health: `1mcp mcp status`
- Pin versions: `1mcp mcp add server --tags=stable -- npx -y @org/server@1.0.0`

**Related Guides**:

- [Claude Desktop Integration](./claude-desktop.md)
- [Configuration Guide](../essentials/configuration.md)
- [Security Best Practices](../../reference/security.md)

## See Also

- **[Proxy Command](../../commands/proxy.md)** - Detailed proxy command documentation
- **[Quick Start](../quick-start.md)** - Basic 1MCP setup
- **[Configuration Guide](../essentials/configuration.md)** - Advanced configuration options
- **[Preset Commands](../../commands/preset/)** - Preset management commands
- **[MCP Commands](../../commands/mcp/)** - MCP server management
