---
title: Quick Start Guide - Get 1MCP Running in 5 Minutes
description: Start using 1MCP in 5 minutes with our quick start guide. Basic setup, configuration, and testing instructions for immediate use.
head:
  - ['meta', { name: 'keywords', content: '1MCP quick start,MCP server setup,AI proxy setup,tutorial' }]
  - ['meta', { property: 'og:title', content: '1MCP Quick Start Guide - 5 Minute Setup' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Get 1MCP running in 5 minutes. Quick setup guide for immediate AI integration.',
      },
    ]
---

# Quick Start

Get 1MCP running in 5 minutes with a basic configuration.

## Prerequisites

- Node.js 18+

## Basic Setup

1.  **Create Configuration**

    ```bash
    # Create a basic config file
    cat > mcp.json << 'EOF'
    {
      "mcpServers": {
        "filesystem": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          "tags": ["local", "files"]
        }
      }
    }
    EOF
    ```

2.  **Start the Server**

    ```bash
    npx -y @1mcp/agent --config mcp.json --port 3000
    ```

3.  **Test Connection**

    The server is now running on port 3000. You can now connect your MCP client to this port.

That's it! Your 1MCP proxy is now running and aggregating MCP servers.

## Project Configuration

**For MCP clients that only support STDIO transport** (like Claude Desktop), you can use project configuration to streamline proxy connections.

### When to Use Project Configuration

Use `.1mcprc` when your MCP client:

- Cannot connect to HTTP/SSE endpoints directly
- Only supports STDIO transport
- Needs to connect to a running 1MCP server

**Prerequisites**: You must have a 1MCP server running (`npx -y @1mcp/agent serve`) for the proxy to connect to.

For projects that regularly use the proxy command, create a `.1mcprc` file to set default connection settings:

```bash
# Create project configuration with preset
echo '{"preset": "my-setup"}' > .1mcprc

# Now simply run:
npx -y @1mcp/agent proxy
```

We recommend using presets for better configuration management. See the [Proxy Command](/commands/proxy) documentation for details.

## Next Steps

- [Enable Authentication](/guide/advanced/authentication) for production use
- [Add More Servers](/guide/essentials/configuration) to expand capabilities
- [Configure Project Settings](/commands/proxy#project-configuration-1mcprc) for team collaboration

## Common Issues

**Server fails to start?**

- Check that Node.js 18+ is installed: `node --version`
- Verify the config file is valid JSON: `cat mcp.json | jq`

**Can't connect to MCP servers?**

- Ensure server commands are executable
- Check server logs for specific error messages
