---
title: Server Management Guide - Transport Types and Best Practices
description: Learn how to manage MCP servers in 1MCP. Covers STDIO and HTTP transports, configuration best practices, and lifecycle management.
head:
  - ['meta', { name: 'keywords', content: 'MCP server management,transport types,STDIO transport,HTTP transport' }]
  - ['meta', { property: 'og:title', content: '1MCP Server Management Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete guide to managing MCP servers in 1MCP. Transport types and best practices.',
      },
    ]
---

# Server Management Guide

This guide provides a detailed overview of managing MCP servers within your 1MCP instance. It covers transport types, configuration best practices, and advanced management workflows.

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

A typical workflow for managing servers looks like this:

1.  **Add a Server**: Add a new server to your 1MCP instance.
    ```bash
    # Add a local git server
    npx -y @1mcp/agent mcp add git-main --type=stdio --command="mcp-server-git" --args="--repository ."
    ```
2.  **Verify the Configuration**: List your servers and check the status of the new one.
    ```bash
    ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent mcp list
    npx -y @1mcp/agent mcp status git-main
    ```
3.  **Update as Needed**: Modify the server's configuration. For example, add a tag.
    ```bash
    npx -y @1mcp/agent mcp update git-main --tags=source-control,project-a
    ```
4.  **Manage its Lifecycle**: If you need to temporarily disable the server, you can do so without losing its configuration.
    ```bash
    npx -y @1mcp/agent mcp disable git-main
    # ...later...
    npx -y @1mcp/agent mcp enable git-main
    ```
5.  **Remove When Done**: If you no longer need the server, you can permanently remove it.
    ```bash
    npx -y @1mcp/agent mcp remove git-main
    ```

## Best Practices

### Configuration

- **Use Descriptive Names**: Give your servers clear, descriptive names.
- **Use Tags for Organization**: Apply a consistent tagging strategy to easily filter and manage your servers. Common tag categories include environment (`dev`, `prod`), function (`database`, `files`), and priority (`critical`, `optional`).
- **Set Appropriate Timeouts**: Configure timeouts based on the expected responsiveness of the server. Local servers can have shorter timeouts than remote ones.

### Security

- **Validate Server Sources**: Only add MCP servers from trusted sources.
- **Manage Secrets**: Use environment variables to pass secrets like API keys to your servers. Avoid hardcoding them in your configuration.
- **Limit Permissions**: Run `stdio` servers with the minimum required permissions.
