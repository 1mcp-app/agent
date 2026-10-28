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

Client startup hooks deliver runtime guidance through `bootstrap`. Fetch `instructions` separately only when guidance is missing or needs refreshing. For checkout selection and caller credentials, see [Project and owner options](/guide/project-checkouts#project-and-owner-options).

Examples use the installed `1mcp` command. Follow [Installation](/guide/installation) to add it to PATH; the installation guide also documents `npx` as an alternative.

## Quick Reference

### Main Commands

- **`serve`** - Start the 1MCP server (default command)
- **`proxy`** - Start STDIO proxy to connect to running 1MCP HTTP server
- **`instructions`** - Show the CLI playbook and current server inventory
- **`inspect`** - List exposed servers or inspect a tool schema
- **`run`** - Call a tool through a running 1MCP server
- **`cli-setup`** - Install Codex or Claude bootstrap hooks and startup docs
- **`project`** - Prepare backends and release, drain, inspect, or resume checkout admission
- **`auth`** - Manage authentication profiles for secured servers
- **`target`** - Manage verified Runtime Target Contexts
- **`admin`** - Manage CLI Admin sessions for Runtime Target Contexts
- **`app`** - Manage desktop application MCP configurations
- **`mcp`** - Manage MCP server configurations
- **`preset`** - Manage server presets for dynamic filtering

### Global Options

All 1MCP commands support the following global options:

- **`--help, -h`** - Show help information
- **`--version`** - Show version information
- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory
- **`--cli-session-cache-path <path>`** - Path template for the `run`/`inspect` CLI session cache file; supports `{pid}` and `{scope}`

**Environment Variables**: All global options can be set via environment variables with the `ONE_MCP_` prefix:

- `ONE_MCP_CONFIG=/path/to/config.json`
- `ONE_MCP_CONFIG_DIR=/path/to/config/dir`
- `ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid}`

### Command-Specific Options

In addition to global options, each command may have specific options. Use `--help` with any command to see all available options:

```bash
1mcp mcp add --help
1mcp preset create --help
1mcp serve --help
1mcp inspect --help
```

## Command Groups

### CLI Workflow Commands

For a standalone terminal session, use these commands to discover and call tools through a running `1mcp serve` instance. In a hooked agent session, use the guidance delivered by bootstrap and run `instructions` only when guidance is missing or needs refreshing. With a named or implicitly discovered local runtime, supported Codex sessions resolve their owner and assigned project automatically. Claude and hosts without automatic owner lookup add their own bootstrap `--project-owner <own-file>` to each call. Each worker uses its own startup context and credential.

```bash
1mcp instructions
1mcp inspect context7
1mcp inspect context7/query-docs
1mcp run context7/query-docs --args '{"libraryId":"/mongodb/docs","query":"aggregation pipeline"}'
```

- **[instructions](/commands/instructions)** - Print the CLI playbook and current servers
- **[inspect](/commands/inspect)** - Discover tools and inspect schemas
- **[run](/commands/run)** - Execute a tool call
- **[wait](/commands/wait)** - Wait for configured static servers to become connected and available
- **[project prepare](/commands/project/prepare)** - Inspect readiness and manage checkout preparation jobs
- **[project lifecycle](/commands/project/)** - Release caller bindings, inspect blockers, drain and resume checkout admission
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
1mcp app consolidate claude-desktop    # Consolidate Claude Desktop servers
1mcp app restore claude-desktop        # Restore original configuration
1mcp app list                          # List supported applications
```

### [MCP Commands](/commands/mcp/)

Manage MCP server configurations within your 1MCP instance.

```bash
1mcp mcp add myserver --type=stdio --command=node --args=server.js
1mcp mcp list                       # List configured servers
1mcp mcp status                     # Check server status
1mcp mcp tools list filesystem --disabled
```

### [Preset Commands](/commands/preset/)

Manage server presets for dynamic filtering and context switching.

```bash
1mcp preset create dev --filter "web,api,database"
1mcp preset list                    # List all presets
1mcp preset show development        # Show preset details
1mcp preset edit staging           # Edit preset configuration
```

### [Serve Command](/commands/serve)

Start the 1MCP server with various configuration options.

```bash
1mcp serve                            # Start with default settings
1mcp serve --port=3052                # Start on custom port
1mcp serve --transport=stdio          # Use stdio transport
```

### [Proxy Command](/commands/proxy)

Start STDIO proxy to connect MCP clients that only support STDIO transport to a running 1MCP HTTP server.

```bash
1mcp proxy                            # Auto-discover and connect
1mcp proxy --url http://localhost:3051/mcp  # Connect to specific URL
1mcp proxy --filter "web,api"         # Connect with tag filtering
```

### Runtime Targets and Admin Sessions

Use a named target when a remote runtime needs saved bearer or Admin credentials.

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp auth login --context prod --token "$TOKEN"
1mcp instructions --context prod
1mcp admin login --context prod --username operator
```

- **[Runtime Target Contexts](/commands/target)** - Add, verify, import, and select named targets
- **[Admin Commands](/commands/admin)** - Bootstrap, login, check, and revoke Admin sessions

### Agent Bootstrap

Use `cli-setup` when you want Codex or Claude sessions to start with the 1MCP bootstrap docs and hooks already configured.

```bash
1mcp cli-setup --codex
1mcp cli-setup --claude --scope repo --repo-root .
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
1mcp serve

# Print the current CLI playbook and server inventory
1mcp instructions

# Inspect one server, then one tool
1mcp inspect filesystem
1mcp inspect filesystem/read_file

# Run the inspected tool
1mcp run filesystem/read_file --args '{"path":"./README.md"}'
```

### Advanced Usage

```bash
# Start with custom configuration
1mcp serve --config=/custom/path/config.json --port=3052

# Add HTTP-based MCP server
1mcp mcp add remote-api --type=http --url=https://api.example.com/mcp

# Install Codex bootstrap docs and hooks
1mcp cli-setup --codex

# Inspect through a preset with JSON output
1mcp inspect filesystem --preset development --format json

# Run a tool while overriding the session cache path
ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid} \
  1mcp run filesystem/read_file --args '{"path":"./README.md"}'
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
