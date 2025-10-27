---
title: Developer & Integration Tools - API and Standards
description: Learn about 1MCP developer tools, RESTful APIs, standards compliance, CLI commands, and integration capabilities for developers.
head:
  - ['meta', { name: 'keywords', content: '1MCP developer tools,API,RESTful,standards,CLI,integration' }]
  - ['meta', { property: 'og:title', content: '1MCP Developer & Integration Tools Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Developer tools and integration capabilities for 1MCP. APIs, CLI, and standards compliance.',
      },
    ]
---

# Developer & Integration

> **🔧 Developer-Friendly**: Clean APIs, standards compliance, and tools for seamless integration and development

## 🔌 RESTful API & Standards Compliance

**What it does**: Clean REST API with full MCP protocol compatibility
**Why you need it**: Easy integration with any client, maintain MCP standard compliance
**How it helps**: Well-documented endpoints, standard HTTP methods, consistent responses

**API Examples**:

```bash
# MCP protocol endpoint
POST /mcp
Content-Type: application/json
Authorization: Bearer {token}

# OAuth management dashboard
GET /oauth

# OAuth endpoints (when auth enabled)
POST /oauth/token
GET /oauth/callback/:serverName
```

**⏱️ Setup Time**: Ready to use immediately
**🎯 Perfect For**: Custom integrations, API clients, third-party tools
**✅ You Get**: Standard REST API, MCP compliance, comprehensive documentation

---

## 📡 HTTP Transport with MCP Protocol

**What it does**: Reliable HTTP-based communication using the MCP protocol standard
**Why you need it**: Standards-compliant communication between AI clients and MCP servers
**How it helps**: Request/response patterns, proper error handling, protocol compliance

**HTTP MCP Example**:

```bash
# MCP protocol over HTTP
POST /mcp
Content-Type: application/json
Authorization: Bearer {token}

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**⏱️ Setup Time**: Built-in, default transport
**🎯 Perfect For**: Standard MCP client integration, reliable communication
**✅ You Get**: MCP protocol compliance, reliable transport, standard HTTP methods

**Note**: SSE transport is deprecated - use HTTP transport instead

---

## 🧪 Development & Integration Support

**What it does**: Provides development-friendly features for testing and integration
**Why you need it**: Easier development, debugging, and integration testing
**How it helps**: Hot-reload configuration, structured logging, MCP Inspector support

**Development Features**:

```bash
# Hot-reload configuration changes
npx -y @1mcp/agent --config dev.json
# Edit dev.json → changes applied automatically

# Use MCP Inspector for testing
npx @modelcontextprotocol/inspector
# Connect to http://localhost:3050 for interactive testing

# Environment-specific logging
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent --config dev.json

# Multiple environment configs
npx -y @1mcp/agent --config dev.json --port 3051
npx -y @1mcp/agent --config staging.json --port 3052
```

**⏱️ Setup Time**: Built-in development features
**🎯 Perfect For**: Development workflows, testing, debugging integration issues
**✅ You Get**: Hot-reload configs, MCP Inspector integration, structured logging, multi-environment support

---

## Development Workflows

### Integration Testing

- **MCP Inspector**: Interactive testing interface for debugging
- **Health Endpoints**: Automated testing of system status
- **Request/Response Logging**: Detailed debugging information
- **Multi-Environment**: Separate configs for dev/staging/production

### API Integration

- **Standard REST**: Easy integration with any HTTP client
- **Error Handling**: Consistent error responses and codes
- **Authentication**: OAuth 2.1 for secure API access

### Debugging and Troubleshooting

- **Structured Logging**: Winston-based logging with levels
- **Request Tracing**: Track requests through the system
- **Health Diagnostics**: Detailed system and server status
- **Configuration Validation**: Early detection of config issues

### Client Libraries

- **HTTP Clients**: Use any HTTP library (fetch, axios, curl)
- **MCP Libraries**: Official MCP client libraries
- **Real-Time Notifications**: Supports receiving real-time updates from servers (e.g., `listChanged` notifications).
- **Custom Integration**: Build your own client implementations

### Development Best Practices

#### Configuration Management

- **Environment Separation**: Different configs for each environment
- **Secret Management**: Secure handling of sensitive data
- **Hot Reload**: Fast development iteration cycles
- **Validation**: Early detection of configuration errors

#### Testing Strategies

- **Unit Testing**: Test individual components and functions
- **Integration Testing**: Test server interactions and workflows
- **End-to-End Testing**: Full system testing with real MCP servers
- **Load Testing**: Performance testing under realistic conditions

#### Monitoring and Observability

- **Request Logging**: Track all API requests and responses
- **Performance Metrics**: Monitor response times and throughput
- **Error Tracking**: Centralized error collection and analysis
- **Health Monitoring**: Continuous system health verification

### Next Steps

- **Core Setup** → [Core Features](/guide/essentials/core-features)
- **Security Integration** → [Security Features](/guide/advanced/security)
- **Production Deployment** → [Enterprise Features](/guide/advanced/enterprise)

### Integration Guides

- **Authentication Setup** → [Authentication Guide](/guide/advanced/authentication)
- **Configuration Reference** → [Configuration Guide](/guide/essentials/configuration)
- **API Documentation** → [API Reference](/reference/health-check)

---

> **🔧 Developer Note**: These features are designed to make integration and development as smooth as possible. Start with the MCP Inspector for interactive testing, then build your integration using the standard HTTP API.
