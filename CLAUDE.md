# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Information

- Repository URL: https://github.com/1mcp-app/agent
- Documentation: https://docs.1mcp.app

## Development Commands

```bash
# Setup
pnpm install
cp .env.example .env  # Required for development

# Build & Run
pnpm build            # Build the project
pnpm dev              # Development with auto-rebuild
pnpm watch            # Watch mode for development

# Quality Checks (run before committing)
pnpm lint && pnpm typecheck && pnpm build && pnpm test:unit

# Testing
pnpm test:unit                              # Run all unit tests
pnpm test:unit src/config/mcpConfigManager.test.ts  # Run single test file
pnpm test:unit --grep "ServerManager"       # Run tests matching pattern
pnpm test:unit:watch                        # Watch mode
pnpm test:unit:coverage                     # With coverage
pnpm test:e2e                               # E2E tests (sequential, with fixtures)
pnpm test:e2e:watch                         # E2E watch mode

# Debug
pnpm inspector                              # MCP Inspector

# Documentation
pnpm docs:dev         # Start VitePress dev server
pnpm docs:build       # Build documentation (run after doc changes)

# Binary
pnpm sea:build        # Create SEA bundle
pnpm sea:binary       # Build binary for current platform
```

## Architecture Overview

1MCP is a unified MCP server that aggregates multiple MCP servers into one endpoint. It acts as a proxy, managing servers as subprocesses and forwarding requests from AI assistants.

### Layered Architecture

```
src/
├── commands/           # CLI commands (yargs-based)
├── transport/          # HTTP/SSE and STDIO protocol implementations
│   └── http/
│       ├── routes/     # Endpoint handlers (oauth, sse, streamable)
│       └── middlewares/# Security, auth, tag extraction
├── core/               # Business logic
│   ├── server/         # ServerManager - lifecycle management
│   ├── capabilities/   # Tool/resource aggregation
│   ├── loading/        # AsyncLoadingOrchestrator
│   └── filtering/      # Request filtering
├── config/             # McpConfigManager with hot-reload
├── auth/               # OAuth 2.1 with scope-based authorization
├── domains/            # Self-contained business domains
│   ├── preset/         # Preset management
│   ├── backup/         # Backup management
│   └── discovery/      # App discovery
├── application/        # Cross-cutting services (health, config reload)
└── logger/             # Winston-based conditional logging
```

### Key Design Patterns

- **Singleton Pattern**: `ServerManager.getInstance()`, `McpConfigManager.getInstance()`, `AgentConfigManager.getInstance()`
- **Factory Pattern**: `TransportFactory` creates protocol-specific transports
- **Proxy Pattern**: 1MCP aggregates multiple MCP servers through unified interface

### Key Files

| Purpose           | Location                                       |
| ----------------- | ---------------------------------------------- |
| Entry Point       | `src/index.ts`                                 |
| Server Lifecycle  | `src/core/server/ServerManager.ts`             |
| Config Management | `src/config/mcpConfigManager.ts`               |
| Transport Factory | `src/transport/transportFactory.ts`            |
| Async Loading     | `src/core/loading/AsyncLoadingOrchestrator.ts` |
| Mock Factories    | `test/unit-utils/MockFactories.ts`             |

## Development Conventions

### Environment Variables

- Access through yargs options (`ONE_MCP_*` prefix auto-loaded), never direct `process.env` access
- Key dev settings in `.env`: `ONE_MCP_LOG_LEVEL=debug`, `ONE_MCP_PORT=3051`, `ONE_MCP_CONFIG_DIR=./config`

### Testing

- **Unit tests**: Co-located `.test.ts` files with source code
- **E2E tests**: `test/e2e/` with dedicated fixtures in `test/e2e/fixtures/`
- **Test isolation**: Use `ONE_MCP_CONFIG_DIR=.tmp-test` for MCP command testing
- **Mock data**: Use `test/unit-utils/MockFactories.ts` for consistent patterns

### Validation

- Use Zod schemas for all input validation and API boundaries
- Schema validation runs before configuration changes are applied

### Conditional Logging

Use `debugIf()`, `infoIf()`, `warnIf()` for performance-critical hot paths:

```typescript
// Good: Expensive operations use callback form
debugIf(() => ({
  message: `Processing ${items.length} items`,
  meta: { itemIds: items.map((i) => i.id) },
}));

// Good: Simple messages use string form
debugIf('Cache hit');

// Bad: Simple messages don't need callback
debugIf(() => ({ message: 'Simple message' })); // Use logger.debug() instead
```

## CLI Development

When adding new commands, follow the pattern in `src/commands/`:

1. Create command file with yargs builder and handler
2. Add unit tests (co-located `.test.ts`)
3. Add E2E tests in `test/e2e/` if needed
4. Update help text

### Testing MCP Commands

```bash
# Isolated testing with temporary config
ONE_MCP_CONFIG_DIR=.tmp-test node build/index.js mcp add test-server -- echo '{"jsonrpc":"2.0"}'

# HTTP transport testing
curl "http://localhost:3050/mcp?app=cursor&tags=filesystem,search"

# STDIO transport with tag filtering
echo '{"jsonrpc":"2.0","method":"initialize","params":{}}' | node build/index.js --transport stdio --tag-filter filesystem
```

## Technology Stack

- **Runtime**: Node.js with child_process APIs for server management
- **Framework**: Express.js with SSE support
- **CLI**: Yargs with comprehensive command parsing
- **Validation**: Zod schemas
- **Logging**: Winston with conditional logging
- **Testing**: Vitest with V8 coverage
- **Build**: esbuild for SEA bundles, tsc for development
