---
title: Server Management Guide - Registry-Based Installation and Configuration
description: Learn how to manage MCP servers in 1MCP using the registry-based approach for server discovery, installation, and lifecycle management.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'MCP server management,registry installation,server discovery,lifecycle management',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Server Management Guide - Registry-Based Approach' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete guide to managing MCP servers in 1MCP using registry-based installation and configuration.',
      },
    ]
---

# Server Management Guide

This guide provides a comprehensive overview of managing MCP servers within your 1MCP instance using the recommended registry-based approach for server discovery, installation, and lifecycle management.

## Registry-Based Workflow (Recommended)

The 1MCP registry provides a centralized repository for discovering, installing, and managing MCP servers with automatic dependency resolution and version management. This is the recommended approach for server management.

### Quick Start

Install your first server from the registry:

```bash
# Search for available servers
npx -y @1mcp/agent registry search --category=filesystem

# Install the filesystem server
npx -y @1mcp/agent mcp install filesystem

# Or use the interactive wizard
npx -y @1mcp/agent mcp wizard
```

### Registry Workflow

1. **Discovery** - Find servers that match your needs
2. **Selection** - Choose servers with version compatibility
3. **Installation** - Automatic dependency resolution and setup
4. **Configuration** - Server-specific customization
5. **Management** - Updates, removal, and lifecycle control

### Registry Benefits

- **Server Discovery** - Browse and search across hundreds of MCP servers
- **Version Management** - Install specific versions with compatibility checking
- **Dependency Resolution** - Automatic installation of required dependencies
- **Security Validation** - Verified servers with integrity checks
- **Update Management** - Easy updates with change tracking
- **Interactive Installation** - Guided setup with the configuration wizard

### Installation Methods

#### Direct Installation

Install servers by name from the registry:

```bash
# Install latest version
npx -y @1mcp/agent mcp install filesystem

# Install specific version
npx -y @1mcp/agent mcp install filesystem@1.2.0

# Install with configuration
npx -y @1mcp/agent mcp install git --repository /path/to/project
```

#### Interactive Wizard

Launch the configuration wizard for guided installation:

```bash
# Start interactive wizard
npx -y @1mcp/agent mcp wizard

# Start with predefined template
npx -y @1mcp/agent mcp wizard --template development
```

The wizard provides:

- Server browsing by category
- Step-by-step configuration
- Compatibility checking
- Best practice recommendations

#### Search and Install

Search the registry and install from results:

```bash
# Search for database servers
npx -y @1mcp/agent registry search database

# Install search results
npx -y @1mcp/agent registry search database --limit=3 --output=list | \
  xargs -n1 npx -y @1mcp/agent mcp install
```

## Transport Types

1MCP supports multiple transport types for connecting to MCP servers.

### STDIO Transport

This is the most common transport for local MCP servers. 1MCP starts the server as a child process and communicates with it over standard input and standard output.

**Use Cases**: Running local tools like `mcp-server-filesystem` or `mcp-server-git`.

**Configuration Example**:

```bash
npx -y @1mcp/agent mcp add filesystem --type=stdio --command="mcp-server-filesystem" --args="--root ~/"
```

**Key Features**:

- **Process Management**: 1MCP manages the lifecycle of the server process.
- **Environment Variables**: Pass environment variables directly to the server process.
- **Working Directory**: Specify a custom working directory for the server.

### Streamable HTTP Transport

This transport connects to an MCP server that is already running and exposed via an HTTP endpoint.

**Use Cases**: Connecting to remote MCP servers, or servers running as part of another application.

**Configuration Example**:

```bash
npx -y @1mcp/agent mcp add remote-api --type=http --url="https://mcp.example.com/"
```

**Key Features**:

- **Remote Access**: Connect to servers on your local network or the internet.
- **Custom Headers**: Add custom HTTP headers for authentication or other purposes.
- **Connection Pooling**: Efficiently manages connections to the remote server.

### SSE Transport (Deprecated)

Server-Sent Events is a deprecated transport type. It is recommended to use the HTTP transport instead.

## Server Configuration Details

Each server you define in 1MCP has a set of common configuration options:

- **Name**: A unique, human-readable name for the server (e.g., `my-git-server`).
- **Transport**: The transport type (`stdio` or `http`).
- **Command/URL**: The command to execute for `stdio` transports, or the URL for `http` transports.
- **Arguments**: An array of command-line arguments for `stdio` servers.
- **Environment**: Key-value pairs of environment variables for `stdio` servers.
- **Tags**: A list of tags for organizing and filtering servers.
- **Timeout**: A connection timeout in milliseconds.
- **Enabled/Disabled**: A flag to enable or disable the server without deleting its configuration.

## Server Management Workflow

### Registry-Based Workflow (Recommended)

The modern workflow using the registry provides automatic dependency resolution and version management:

1.  **Discover Servers**: Search the registry for servers that meet your needs.

    ```bash
    # Search for development servers
    npx -y @1mcp/agent registry search --category=development

    # Browse all available servers
    npx -y @1mcp/agent mcp wizard
    ```

2.  **Install Servers**: Install servers with automatic configuration.

    ```bash
    # Install the filesystem server
    npx -y @1mcp/agent mcp install filesystem

    # Install specific version
    npx -y @1mcp/agent mcp install git@1.2.0
    ```

3.  **Verify Installation**: Check that servers are properly installed and running.

    ```bash
    npx -y @1mcp/agent mcp list
    npx -y @1mcp/agent mcp status filesystem
    ```

4.  **Manage Updates**: Keep servers updated with latest versions.

    ```bash
    # Check for available updates
    npx -y @1mcp/agent registry search --updates

    # Update specific server
    npx -y @1mcp/agent mcp update filesystem
    ```

5.  **Manage Lifecycle**: Enable, disable, or remove servers as needed.

    ```bash
    # Temporarily disable
    npx -y @1mcp/agent mcp disable filesystem

    # Re-enable
    npx -y @1mcp/agent mcp enable filesystem

    # Remove with backup
    npx -y @1mcp/agent mcp uninstall filesystem
    ```

### Manual Configuration Workflow (Advanced)

For custom servers not available in the registry:

1.  **Add Server Manually**: Configure server details manually.

    ```bash
    npx -y @1mcp/agent mcp add custom-server --type=stdio --command="node server.js"
    ```

2.  **Configure Settings**: Set server-specific options.
    ```bash
    npx -y @1mcp/agent mcp update custom-server --tags=custom,experimental --args="--port=3000"
    ```

The registry-based approach is recommended for most users, with manual configuration reserved for custom or proprietary servers.

## Best Practices

### Configuration

- **Use Descriptive Names**: Give your servers clear, descriptive names.
- **Use Tags for Organization**: Apply a consistent tagging strategy to easily filter and manage your servers. Common tag categories include environment (`dev`, `prod`), function (`database`, `files`), and priority (`critical`, `optional`).
- **Set Appropriate Timeouts**: Configure timeouts based on the expected responsiveness of the server. Local servers can have shorter timeouts than remote ones.

### Security

- **Validate Server Sources**: Only add MCP servers from trusted sources.
- **Manage Secrets**: Use environment variables to pass secrets like API keys to your servers. Avoid hardcoding them in your configuration.
- **Limit Permissions**: Run `stdio` servers with the minimum required permissions.
