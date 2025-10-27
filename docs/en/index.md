---
layout: home
title: '1MCP Agent - One Unified MCP Server for All'
description: 'The unified Model Context Protocol server that aggregates multiple MCP servers for Claude Desktop, Cursor, and AI assistants. Get started in minutes with OAuth 2.1 security.'
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'MCP server,Model Context Protocol,AI proxy,AI aggregator,Claude Desktop,Cursor,MCP integration,AI assistant tools,OAuth 2.1,proxy server,multiplexer,LLM integration,automation,tutorial,setup guide',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Agent - Unified MCP Server' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Unified Model Context Protocol server that aggregates multiple MCP servers. Start in 5 minutes.',
      },
    ]
  - ['meta', { name: 'twitter:title', content: '1MCP Agent - Unified MCP Server' }]
  - [
      'meta',
      {
        name: 'twitter:description',
        content: 'Unified MCP server for AI assistants. Start in 5 minutes with OAuth 2.1 security.',
      },
    ]

hero:
  name: '1MCP Agent'
  text: 'One MCP server to aggregate them all'
  tagline: A unified Model Context Protocol server implementation that acts as a proxy/multiplexer for multiple MCP servers
  image:
    src: /images/logo.png
    alt: 1MCP Agent Logo - Unified MCP Server for AI Assistants
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Quick Start
      link: /guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/1mcp-app/agent

features:
  - icon: 🔄
    title: Unified Interface
    details: Single endpoint that aggregates multiple MCP servers, simplifying AI assistant integration
  - icon: 🔒
    title: OAuth 2.1 Authentication
    details: Production-ready security with scope-based authorization and secure token management
  - icon: ⚡
    title: High Performance
    details: Efficient request forwarding with proper error handling and monitoring capabilities
  - icon: 🛡️
    title: Security First
    details: Stdio transport isolation, input sanitization, and comprehensive audit logging

  - icon: 🔧
    title: Easy Configuration
    details: Single JSON configuration file with hot-reload support and validation
---

## Why 1MCP?

**The Problem**: AI assistants need to connect to multiple MCP servers, but managing dozens of individual connections is complex, unreliable, and security-intensive.

**The Solution**: 1MCP acts as a unified proxy/multiplexer that aggregates multiple MCP servers behind a single, reliable interface. Learn more about our [core features](/guide/essentials/core-features) and [security architecture](/reference/security).

```mermaid
graph TB
    subgraph "AI Clients"
        C1[Claude Desktop]
        C2[Cursor]
        C3[Cherry Studio]
    end

    subgraph "1MCP Proxy"
        P[Unified Interface<br/>HTTP/SSE + OAuth]
    end

    subgraph "MCP Servers"
        S1[Filesystem]
        S2[Web Search]
        S3[Database]
        S4[Memory]
    end

    C1 --> P
    C2 --> P
    C3 --> P
    P --> S1
    P --> S2
    P --> S3
    P --> S4
```

## Quick Example

Start with a simple configuration. For complete setup instructions, see our [getting started guide](/guide/getting-started) and [installation instructions](/guide/installation).

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"],
      "tags": ["context7", "docs", "development", "code"],
      "disabled": false
    },
    "git": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "/path/to/your/awesome-project"],
      "tags": ["git", "awesome-project"],
      "disabled": false
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "tags": ["files", "tmpdir"],
      "disabled": false
    },
    "server-sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "tags": ["thinking"],
      "disabled": false
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
      "tags": ["playwright", "frontend", "web", "ui", "browser"],
      "disabled": false
    }
  }
}
```

```bash
# Start the proxy
npx -y @1mcp/agent --config mcp.json --port 3000
```

Now your agent is running. Connect your MCP client to `http://localhost:3000` to start using your aggregated tools. Check our [server management guide](/guide/essentials/server-management) for advanced configuration options.

## Key Benefits

- **🎯 Simplified Integration**: One connection instead of many
- **🔐 Production Security**: OAuth 2.1 with scope-based permissions
- **📈 Better Reliability**: Centralized error handling and monitoring
- **⚙️ Easy Management**: Single configuration, hot-reload support
- **🚀 Performance**: Efficient multiplexing with minimal overhead

## What's Next?

<div class="vp-feature-grid">
  <a href="/guide/getting-started" class="vp-feature-box">
    <h3>📚 Learn the Basics</h3>
    <p>Understand 1MCP architecture and core concepts</p>
  </a>

  <a href="/guide/quick-start" class="vp-feature-box">
    <h3>⚡ Quick Start</h3>
    <p>Get running in 5 minutes with basic configuration</p>
  </a>

  <a href="/reference/architecture" class="vp-feature-box">
    <h3>🏗️ Deep Dive</h3>
    <p>Comprehensive system architecture and design decisions</p>
  </a>
</div>

<style>
.vp-feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
  margin-top: 2rem;
}

.vp-feature-box {
  padding: 1.5rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  text-decoration: none;
  transition: border-color 0.25s;
}

.vp-feature-box:hover {
  border-color: var(--vp-c-brand);
}

.vp-feature-box h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
}

.vp-feature-box p {
  margin: 0;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}
</style>
