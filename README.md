# 1MCP - One MCP Server for All

A unified Model Context Protocol server implementation that aggregates multiple MCP servers into one.

[![NPM Version](https://img.shields.io/npm/v/@1mcp/agent)](https://www.npmjs.com/package/@1mcp/agent)
[![NPM Downloads](https://img.shields.io/npm/dm/%401mcp%252Fagent)](https://www.npmjs.com/package/@1mcp/agent)
[![CodeQl](https://github.com/1mcp-app/agent/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/1mcp-app/agent/actions/workflows/github-code-scanning/codeql)
[![GitHub Repo stars](https://img.shields.io/github/stars/1mcp-app/agent)](https://github.com/1mcp-app/agent/stargazers)
[![1MCP Docs](https://img.shields.io/badge/1MCP-Official%20Docs-blue)](https://docs.1mcp.app)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-AI%20Docs-purple.svg?logo=gitbook&logoColor=white)](https://deepwiki.com/1mcp-app/agent)
[![NPM License](https://img.shields.io/npm/l/@1mcp/agent)](https://www.npmjs.com/package/@1mcp/agent)

## Overview

1MCP (One MCP) is designed to simplify the way you work with AI assistants. Instead of configuring multiple MCP servers for different clients (Claude Desktop, Cherry Studio, Cursor, Roo Code, Claude, etc.), 1MCP provides a single, unified server.

## Features

- **🔄 Unified Interface**: Aggregates multiple MCP servers into one
- **🔒 OAuth 2.1 Authentication**: Production-ready security with scope-based authorization
- **⚡ High Performance**: Efficient request forwarding with proper error handling
- **🛡️ Security First**: Stdio transport isolation, input sanitization, and comprehensive audit logging
- **🔧 Easy Configuration**: Single JSON configuration file with hot-reload support
- **📈 Health Monitoring**: Built-in health check endpoints for monitoring and observability

## Quick Start

### 1. Install 1MCP

**Binary (Recommended - No Node.js Required):**

```bash
# Linux/macOS
curl -L https://github.com/1mcp-app/agent/releases/latest/download/1mcp-linux-x64.tar.gz | tar -xz
sudo mv 1mcp /usr/local/bin/

# Windows (PowerShell)
Invoke-WebRequest -Uri "https://github.com/1mcp-app/agent/releases/latest/download/1mcp-win32-x64.zip" -OutFile "1mcp.zip"
Expand-Archive -Path "1mcp.zip" -DestinationPath "."
```

**NPM:**

```bash
npx -y @1mcp/agent --help
```

### 2. Add MCP Servers

```bash
1mcp mcp add context7 -- npx -y @upstash/context7-mcp
1mcp mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem ~/Documents
```

### 3. Start the Server

```bash
1mcp
```

### 4. Connect Your AI Assistant

**For Cursor**, add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "1mcp": {
      "url": "http://127.0.0.1:3050/mcp?app=cursor"
    }
  }
}
```

[![Install MCP Server to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=1mcp&config=eyJ1cmwiOiJodHRwOi8vMTI3LjAuMC4xOjMwNTAvbWNwP2FwcD1jdXJzb3IifQ%3D%3D)

**For VSCode**, add to `settings.json`:

```json
{
  "servers": {
    "1mcp": {
      "url": "http://127.0.0.1:3050/mcp?app=vscode"
    }
  }
}
```

[Install MCP Server to VSCode](vscode:mcp/install?%7B%22name%22%3A%221mcp%22%2C%22url%22%3A%22http%3A%2F%2F127.0.0.1%3A3050%2Fmcp%3Fapp%3Dvscode%22%7D)

**For Claude Code:**

```bash
claude mcp add -t http 1mcp "http://127.0.0.1:3050/mcp?app=claude-code"
```

That's it! All your MCP servers are now available through one unified endpoint. 🎉

## Commands

### Core Commands

- **`1mcp [serve]`** - Start the 1MCP server (default command)
- **`1mcp mcp add <name>`** - Add a new MCP server to configuration
- **`1mcp mcp list`** - List all configured MCP servers
- **`1mcp mcp status [name]`** - Show server status and details

For detailed command usage, run: `1mcp <command> --help`

## Documentation

📚 **[Complete Documentation](https://docs.1mcp.app)** - Comprehensive guides, API reference, and examples

### Key Topics

- **[Installation Guide](https://docs.1mcp.app/guide/installation)** - Binary, NPM, and Docker installation
- **[Quick Start](https://docs.1mcp.app/guide/quick-start)** - Get running in 5 minutes
- **[Configuration](https://docs.1mcp.app/guide/essentials/configuration)** - CLI flags and environment variables
- **[Authentication](https://docs.1mcp.app/guide/advanced/authentication)** - OAuth 2.1 security setup
- **[Architecture](https://docs.1mcp.app/reference/architecture)** - How 1MCP works internally
- **[Development](https://docs.1mcp.app/guide/development)** - Contributing and building from source

## How It Works

1MCP acts as a proxy, managing and aggregating multiple MCP servers. It starts and stops these servers as subprocesses and forwards requests from AI assistants to the appropriate server. This architecture allows for a single point of entry for all MCP traffic, simplifying management and reducing overhead.

## Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
