# 1MCP

[![NPM Version](https://img.shields.io/npm/v/@1mcp/agent)](https://www.npmjs.com/package/@1mcp/agent)
[![NPM Downloads](https://img.shields.io/npm/dm/%401mcp%252Fagent)](https://www.npmjs.com/package/@1mcp/agent)
[![CodeQl](https://github.com/1mcp-app/agent/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/1mcp-app/agent/actions/workflows/github-code-scanning/codeql)
[![GitHub Repo stars](https://img.shields.io/github/stars/1mcp-app/agent)](https://github.com/1mcp-app/agent/stargazers)
[![Docs](https://img.shields.io/badge/docs-docs.1mcp.app-blue)](https://docs.1mcp.app)
[![License](https://img.shields.io/npm/l/@1mcp/agent)](https://www.npmjs.com/package/@1mcp/agent)

1MCP is the unified MCP runtime. `1mcp serve` aggregates your MCP servers, and CLI mode adds a thinner agent-facing workflow for Codex, Claude, and similar tool-using agents.

## Why 1MCP

Most MCP setups eventually hit two kinds of sprawl:

- Configuration sprawl: every client needs its own MCP wiring, auth choices, and filtering rules.
- Agent sprawl: autonomous sessions carry too many tools and schemas into context up front.

1MCP addresses both:

- `1mcp serve` gives you one aggregated runtime in front of many MCP servers.
- CLI mode lets agents discover tools progressively with `instructions`, `inspect`, and `run`.
- Static servers can load at startup, while template servers are created from per-client or per-session context.
- Presets, filters, and instruction aggregation keep the same runtime adaptable across clients and projects.

| Approach              | Best for                    | Tradeoff                                                  |
| --------------------- | --------------------------- | --------------------------------------------------------- |
| 1MCP CLI mode         | Codex, Claude, agent loops  | Requires a running `1mcp serve` instance                  |
| Direct MCP attachment | MCP-native HTTP clients     | Broader tool surface is exposed directly to the client    |
| Custom proxying       | One-off compatibility shims | You own discovery, filtering, auth, and runtime lifecycle |

## Quick Start

Install 1MCP, add a server, and start the runtime:

```bash
npm install -g @1mcp/agent
1mcp mcp add context7 -- npx -y @upstash/context7-mcp
1mcp serve
```

At that point you can choose one of the two supported client paths below.

## Recommended: CLI Mode for Agents

CLI mode is the primary workflow for agent-style sessions. It keeps MCP as the backend protocol but narrows what the agent sees at each step.

User setup:

```bash
1mcp cli-setup --codex
# or
1mcp cli-setup --claude --scope repo --repo-root .
```

Typical agent workflow:

```bash
# shell 1
1mcp serve

# shell 2
1mcp instructions
1mcp inspect context7
1mcp inspect context7/get-library-docs
1mcp run context7/get-library-docs --args '{"context7CompatibleLibraryID":"/mongodb/docs","topic":"aggregation pipeline"}'
```

For a given agent, choose one mode only. If you switch that agent to CLI mode, remove its old direct MCP configuration first.

## Alternative: Direct MCP Attachment

Direct MCP attachment is still supported for clients that want to talk to the aggregated runtime over HTTP.

Examples:

```json
{
  "mcpServers": {
    "1mcp": {
      "url": "http://127.0.0.1:3050/mcp?app=cursor"
    }
  }
}
```

```bash
claude mcp add -t http 1mcp "http://127.0.0.1:3050/mcp?app=claude-code"
```

Use this path for MCP-native clients. For Codex, Claude, and similar agent loops, prefer CLI mode.

## How It Works

```mermaid
flowchart LR
    A[User or Agent] --> B[1mcp serve]
    B --> C[Static servers loaded at startup]
    B --> D[Template servers resolved from client or session context]
    A --> E[CLI mode: instructions -> inspect -> run]
    E --> B
    F[Direct HTTP MCP client] --> B
    G[stdio-only client] --> H[1mcp proxy]
    H --> B
```

1MCP runs as an aggregated runtime behind `1mcp serve`. Static servers are prepared from startup configuration, template servers are materialized when client context is known, and the runtime can use async loading and lazy loading to reduce startup blocking and tool-surface noise. Instruction aggregation, presets, and notifications sit alongside that runtime rather than outside it.

## Core Capabilities

- Unified runtime for many MCP servers behind one `serve` process
- CLI mode for progressive discovery with `1mcp instructions`, `1mcp inspect <server>`, `1mcp inspect <server>/<tool>`, and `1mcp run <server>/<tool> --args '<json>'`
- Template servers for per-client or per-session resolution
- Async loading and lazy loading for faster startup and narrower exposure
- Instruction aggregation across static and template-backed servers
- Presets, filters, and preset change notifications
- Direct HTTP MCP access plus `proxy` for stdio-only compatibility

## Common Use Cases

- Give a coding agent one stable runtime but a smaller working surface.
- Share the same MCP inventory across Cursor, Claude Code, Codex, and internal tooling.
- Expose context-specific template servers per repo, branch, or session.
- Centralize auth, filtering, presets, and runtime lifecycle instead of rebuilding them in ad hoc scripts.

## Docs by Persona

- Agent users: [CLI mode guide](https://docs.1mcp.app/guide/integrations/cli-mode), [cli-setup](https://docs.1mcp.app/commands/cli-setup), [instructions](https://docs.1mcp.app/commands/instructions)
- MCP client integrators: [serve](https://docs.1mcp.app/commands/serve), [proxy](https://docs.1mcp.app/commands/proxy), [architecture](https://docs.1mcp.app/reference/architecture)
- Runtime operators: [configuration](https://docs.1mcp.app/guide/essentials/configuration), [presets](https://docs.1mcp.app/commands/preset), [authentication](https://docs.1mcp.app/guide/advanced/authentication)
- Contributors: [development guide](https://docs.1mcp.app/guide/development), [CONTRIBUTING.md](CONTRIBUTING.md)

## Contributing / License

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [LICENSE](LICENSE) for the Apache 2.0 license.
