---
title: Development Guide - Build and Contribute
description: Set up development environment for 1MCP Agent. Learn how to build from source, run tests, and contribute to the project.
head:
  - ['meta', { name: 'keywords', content: '1MCP development,build from source,contribute,development environment' }]
  - ['meta', { property: 'og:title', content: '1MCP Development Guide' }]
  - [
      'meta',
      { property: 'og:description', content: 'Development guide for 1MCP Agent. Build from source and contribute.' },
    ]
---

# Development

This guide covers how to set up a development environment for 1MCP Agent, build from source, and contribute to the project.

## Prerequisites

- [Node.js](https://nodejs.org/) (version 21 or higher)
- [pnpm](https://pnpm.io/) package manager
- Git

## Installation from Source

1. **Clone the repository**

   ```bash
   git clone https://github.com/1mcp-app/agent.git
   cd agent
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Build the project**

   ```bash
   pnpm build
   ```

4. **Run the development server**

   ```bash
   # Copy the example environment file first
   cp .env.example .env

   # Then run the development server
   pnpm dev
   ```

## Development Workflow

### Available Scripts

```bash
# Development with auto-rebuild and test config
pnpm dev

# Build the project
pnpm build

# Watch mode for development
pnpm watch

# Linting
pnpm lint
pnpm lint:fix

# Type checking
pnpm typecheck

# Testing
pnpm test:unit
pnpm test:unit:watch
pnpm test:unit:coverage
pnpm test:e2e
pnpm test:e2e:watch
pnpm test:e2e:coverage

# Debug with MCP Inspector
pnpm inspector

# Additional utilities
pnpm clean         # Clean build artifacts
pnpm format        # Format code with Prettier
pnpm format:check  # Check code formatting

# Binary and packaging
pnpm sea:build     # Create SEA bundle
pnpm sea:binary    # Build binary for current platform
pnpm build:binaries # Build all platform binaries

# Documentation
pnpm docs:dev      # Start VitePress dev server
pnpm docs:build    # Build documentation
pnpm docs:preview  # Preview built docs
```

### Development Environment Setup

Before starting development, copy the environment template:

```bash
cp .env.example .env
```

The `.env` file contains development-specific configurations including:

- `ONE_MCP_LOG_LEVEL=debug` - Enhanced logging for development
- `ONE_MCP_LOG_FILE=./build/1mcp.log` - Log file location
- `ONE_MCP_PORT=3051` - Development server port
- `ONE_MCP_ENABLE_AUTH=true` - Authentication enabled
- `ONE_MCP_ENABLE_ASYNC_LOADING=true` - Async loading enabled
- `ONE_MCP_CONFIG_DIR=./config` - Custom config directory for development

## Architecture Overview

1MCP follows a layered architecture with clear separation of concerns:

- **Transport Layer** (`src/transport/`) - HTTP/SSE and STDIO protocol implementations
- **Application Layer** (`src/commands/`) - CLI commands and user-facing functionality
- **Core Layer** (`src/core/`) - Server management, capability aggregation, async loading
- **Supporting Services** (`src/services/`, `src/config/`, `src/auth/`) - Configuration, authentication, health monitoring

### Key Design Patterns

- **Singleton Pattern**: ServerManager, McpConfigManager, AgentConfigManager use `getInstance()`
- **Factory Pattern**: TransportFactory creates protocol-specific transports
- **Proxy Pattern**: 1MCP aggregates multiple MCP servers through unified interface
- **Observer Pattern**: Event-driven loading with real-time capability updates

### Core Components

- **ServerManager** (`src/core/server/`) - Manages MCP server lifecycle and connections
- **McpConfigManager** (`src/config/`) - Configuration management with hot-reload
- **TransportFactory** (`src/transport/`) - Creates HTTP/STDIO transport instances
- **CapabilitiesManager** (`src/core/capabilities/`) - Aggregates tools/resources from multiple servers

## Debugging

### Using the MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is available as a package script:

```bash
pnpm inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

### Debugging & Source Maps

This project uses [source-map-support](https://www.npmjs.com/package/source-map-support) to enhance stack traces. When you run the server, stack traces will reference the original TypeScript source files instead of the compiled JavaScript. This makes debugging much easier, as error locations and line numbers will match your source code.

No extra setup is required—this is enabled by default. If you see a stack trace, it will point to `.ts` files and the correct line numbers. 🗺️

## Testing

### Test Configuration Isolation

When testing "mcp" sub commands, always use a temp config within this project, do not break user's default config:

```bash
# Use temporary config directory
ONE_MCP_CONFIG_DIR=.tmp-test node build/index.js mcp add test-server -- echo '{"jsonrpc":"2.0"}'

# Or use --config-dir flag
node build/index.js --config-dir .tmp-test mcp add test-server -- echo '{"jsonrpc":"2.0"}'
```

The config directory feature allows for project-specific configurations, which is useful for testing different setups without affecting the global config.

### Environment and Configuration

- Do not use env of ONE*MCP*\* directly, use options from yargs instead, env will be loaded into options
- Should verify the docs using `pnpm docs:build` after you modify the docs

### Binary Development and Testing

- Use `pnpm sea:build` to create Single Executable Application (SEA) bundles
- Test binaries with `pnpm sea:binary` for current platform or platform-specific scripts
- Binary development requires Node.js SEA support and postject for injection
- SEA configuration is in `sea-config.json`

### Testing Infrastructure

- **Unit Tests**: Co-located `.test.ts` files with source code
- **E2E Tests**: Located in `test/e2e/` with dedicated configuration
- **Mock Utilities**: Use `test/unit-utils/MockFactories.ts` for consistent test data
- **Test Isolation**: Each test should clean up resources and not affect others

## CLI Command Development

When adding new CLI commands:

1. **Command Structure**: Follow existing pattern in `src/commands/`
2. **Yargs Integration**: Use proper command builders with validation
3. **Error Handling**: Implement graceful error handling with user-friendly messages
4. **Testing**: Create both unit tests and E2E tests for command functionality
5. **Documentation**: Update help text and consider docs impact

### MCP Command Examples

- `mcp add <name>` - Add new MCP server configuration
- `mcp status [name]` - Show server status and health
- `mcp list` - List all configured servers with tags and status

## MCP Server Integration Patterns

### Server Lifecycle Management

- MCP servers are managed as child processes through `src/core/server/ServerManager.ts`
- Use async loading to handle slow-starting servers gracefully
- Implement proper cleanup on shutdown using process signal handlers

### Transport Abstraction

- HTTP transport supports multiple clients via SSE (Server-Sent Events)
- STDIO transport provides direct MCP protocol communication
- Tag filtering allows selective server exposure to different clients

### Configuration Management

- Hot-reload configuration without stopping active connections
- Support environment variable overrides for all configuration options
- Validate configuration schemas using Zod before applying changes

### Testing MCP Integration

When testing MCP functionality:

```bash
# Test specific MCP server with temporary config
ONE_MCP_CONFIG_DIR=.tmp-test node build/index.js mcp add test-server -- echo '{"jsonrpc":"2.0"}'

# Test HTTP transport with different client types
curl "http://localhost:3050/mcp?app=cursor&tags=filesystem"

# Test STDIO transport with tag filtering
echo '{"jsonrpc":"2.0","method":"initialize","params":{}}' | node build/index.js --transport stdio --tag-filter filesystem
```

## Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](https://github.com/1mcp-app/agent/blob/main/CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

### Development Guidelines

- Always use pnpm scripts like "lint", "typecheck", "build" and "test" to validate the implementation
- Avoid using "any" keyword in TypeScript
- Follow security-first practices with proper input sanitization using Zod schemas
- Use existing utility functions for common operations (pagination, filtering, error handling)
- Implement proper error handling with specific error types and graceful degradation
- Use singleton pattern for core managers and factory pattern for object creation
- Follow the layered architecture with clear separation of concerns
- Use Vitest for testing with co-located unit tests (`.test.ts`) and dedicated E2E test infrastructure in `test/e2e/`
- Implement OAuth 2.1 authentication with scope-based authorization using tag validation
- Use structured logging with Winston and conditional logging functions (`debugIf`, `infoIf`, `warnIf`)
- Follow hot-reload patterns for configuration management with file system watchers
- Implement proper resource cleanup for long-running processes and subprocess management
- When new bug found, always write formal unit tests to reproduce it before fixing

## Next Steps

- [Configuration Deep Dive](/guide/essentials/configuration) - Detailed setup options
- [Architecture Reference](/reference/architecture) - System design and patterns
- [Contributing Guide](https://github.com/1mcp-app/agent/blob/main/CONTRIBUTING.md) - How to contribute
