---
title: Command Reference - Complete 1MCP CLI Guide
description: Complete command reference for 1MCP Agent. Learn serve, proxy, instructions, inspect, run, cli-setup, and other CLI commands with examples.
head:
  - ['meta', { name: 'keywords', content: '1MCP commands,CLI reference,command-line interface,syntax,examples' }]
  - ['meta', { property: 'og:title', content: '1MCP Command Reference - Complete Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete command reference for 1MCP Agent CLI. Commands, options, and examples.',
      },
    ]
---

# Command Reference

This section is the CLI lookup entrypoint. Use it when you already know which command family you need and want exact syntax, options, or examples.

For AI agents, the preferred path is CLI mode: keep MCP behind `1mcp serve`, then use `instructions`, `inspect`, and `run` as a progressive-disclosure workflow instead of exposing a broad tool surface directly in the agent loop.

If you are still trying to get a first setup working, use [Quick Start](/guide/quick-start) before drilling into command details.

## Quick Reference

### Main Commands

- **`serve`** - Start the 1MCP server (default command)
- **`proxy`** - Start STDIO proxy to connect to running 1MCP HTTP server
- **`instructions`** - Show the CLI playbook and current server inventory
- **`inspect`** - List exposed servers or inspect a tool schema
- **`run`** - Call a tool through a running 1MCP server
- **`cli-setup`** - Install Codex or Claude bootstrap hooks and startup docs
- **`auth`** - Manage authentication profiles for secured servers
- **`app`** - Manage desktop application MCP configurations
- **`mcp`** - Manage MCP server configurations
- **`preset`** - Manage server presets for dynamic filtering

### Global Options

All 1MCP commands support the following global options:

- **`--help, -h`** - Show help information
- **`--version`** - Show version information
- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory
- **`--cli-session-cache-path <path>`** - Path template for the `run`/`inspect` CLI session cache file

**Environment Variables**: All global options can be set via environment variables with the `ONE_MCP_` prefix:

- `ONE_MCP_CONFIG=/path/to/config.json`
- `ONE_MCP_CONFIG_DIR=/path/to/config/dir`
- `ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid}`

### Command-Specific Options

In addition to global options, each command may have specific options. Use `--help` with any command to see all available options:

```bash
npx -y @1mcp/agent mcp add --help
npx -y @1mcp/agent preset create --help
npx -y @1mcp/agent serve --help
npx -y @1mcp/agent inspect --help
```

## Command Groups

### CLI Workflow Commands

Use these commands together when you want an agent or terminal session to discover and call tools through a running `1mcp serve` instance.

```bash
npx -y @1mcp/agent instructions
npx -y @1mcp/agent inspect context7
npx -y @1mcp/agent inspect context7/query-docs
npx -y @1mcp/agent run context7/query-docs --args '{"libraryId":"/mongodb/docs","query":"aggregation pipeline"}'
```

- **[instructions](/commands/instructions)** - Print the CLI playbook and current servers
- **[inspect](/commands/inspect)** - Discover tools and inspect schemas
- **[run](/commands/run)** - Execute a tool call
- **[cli-setup](/commands/cli-setup)** - Install Codex or Claude bootstrap files
- **[auth](/commands/auth)** - Manage authentication profiles for secured servers

Use this group when an agent or operator is already working against a running `1mcp serve` instance.

### Why These Commands Exist

- Direct MCP is still the backend interoperability layer
- CLI mode is the preferred frontend workflow for agents
- `instructions` gives a compact inventory instead of a broad direct starting surface
- `inspect` narrows discovery to one server and one tool
- `run` executes only after schema confirmation

### [App Commands](/commands/app/)

Manage desktop application MCP configurations. Consolidate MCP servers from various desktop applications into 1MCP.

```bash
npx -y @1mcp/agent app consolidate claude-desktop    # Consolidate Claude Desktop servers
npx -y @1mcp/agent app restore claude-desktop        # Restore original configuration
npx -y @1mcp/agent app list                          # List supported applications
```

### [MCP Commands](/commands/mcp/)

Manage MCP server configurations within your 1MCP instance.

```bash
npx -y @1mcp/agent mcp add myserver --type=stdio --command=node --args=server.js
npx -y @1mcp/agent mcp list                       # List configured servers
npx -y @1mcp/agent mcp status                     # Check server status
```

### [Preset Commands](/commands/preset/)

Manage server presets for dynamic filtering and context switching.

```bash
npx -y @1mcp/agent preset create dev --filter "web,api,database"
npx -y @1mcp/agent preset list                    # List all presets
npx -y @1mcp/agent preset show development        # Show preset details
npx -y @1mcp/agent preset edit staging           # Edit preset configuration
```

### [Serve Command](/commands/serve)

Start the 1MCP server with various configuration options.

```bash
npx -y @1mcp/agent serve                            # Start with default settings
npx -y @1mcp/agent serve --port=3052                # Start on custom port
npx -y @1mcp/agent serve --transport=stdio          # Use stdio transport
```

### [Proxy Command](/commands/proxy)

Start STDIO proxy to connect MCP clients that only support STDIO transport to a running 1MCP HTTP server.

```bash
npx -y @1mcp/agent proxy                            # Auto-discover and connect
npx -y @1mcp/agent proxy --url http://localhost:3051/mcp  # Connect to specific URL
npx -y @1mcp/agent proxy --filter "web,api"         # Connect with tag filtering
```

### Agent Bootstrap

Use `cli-setup` when you want Codex or Claude sessions to start with the 1MCP bootstrap docs and hooks already configured.

```bash
npx -y @1mcp/agent cli-setup --codex
npx -y @1mcp/agent cli-setup --claude --scope repo --repo-root .
```

## When to Leave This Section

If you need learning or setup guidance instead of exact command behavior, go to:

1. **[Installation Guide](/guide/installation)** - Install 1MCP Agent
2. **[Quick Start](/guide/quick-start)** - Basic setup and first server
3. **[Instructions Command](/commands/instructions)** - Start the CLI workflow with the current server inventory
4. **[Inspect Command](/commands/inspect)** - Discover tools and inspect schemas
5. **[Run Command](/commands/run)** - Execute a tool call through the running server

## Examples

### Basic Usage

```bash
# Start 1MCP server
npx -y @1mcp/agent serve

# Print the current CLI playbook and server inventory
npx -y @1mcp/agent instructions

# Inspect one server, then one tool
npx -y @1mcp/agent inspect filesystem
npx -y @1mcp/agent inspect filesystem/read_file

# Run the inspected tool
npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
```

### Advanced Usage

```bash
# Start with custom configuration
npx -y @1mcp/agent serve --config=/custom/path/config.json --port=3052

# Add HTTP-based MCP server
npx -y @1mcp/agent mcp add remote-api --type=http --url=https://api.example.com/mcp

# Install Codex bootstrap docs and hooks
npx -y @1mcp/agent cli-setup --codex

# Inspect through a preset with JSON output
npx -y @1mcp/agent inspect filesystem --preset development --format json

# Run a tool while overriding the session cache path
ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid} \
  npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
```

## Environment Variables

All command-line options can also be set via environment variables with the `ONE_MCP_` prefix:

```bash
export ONE_MCP_PORT=3052
export ONE_MCP_HOST=0.0.0.0
export ONE_MCP_CONFIG=/custom/config.json
```

## Configuration Files

1MCP Agent uses JSON configuration files to store server definitions and settings. See the [Configuration Guide](/guide/essentials/configuration) for detailed information about configuration file formats and options.
