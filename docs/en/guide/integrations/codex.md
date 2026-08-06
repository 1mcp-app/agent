---
title: Codex Integration
description: "Choose one 1MCP workflow for Codex: CLI mode, direct HTTP, or the stdio proxy."
head:
  - ['meta', { name: 'keywords', content: '1MCP Codex integration,Codex MCP,config.toml,stdio proxy' }]
  - ['meta', { property: 'og:title', content: '1MCP Codex Integration' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Choose one 1MCP workflow for Codex: CLI mode, direct HTTP, or the stdio proxy.',
      },
    ]
---

# Codex Integration

Current Codex supports MCP configuration in a trusted project's `.codex/config.toml`. Use that project-scoped file when the MCP server belongs only to that repository; use `~/.codex/config.toml` for a personal default. See the official [Codex configuration reference](https://developers.openai.com/codex/config-reference/#configtoml) for trust and configuration-scope details.

Choose exactly one agent-facing 1MCP mode for a Codex project. Do not keep a direct HTTP entry, a proxy entry, and the CLI workflow enabled together: they expose duplicate tool surfaces and make tool selection ambiguous.

| Mode | Use it when | Do not configure |
| --- | --- | --- |
| CLI mode | Codex should use 1MCP commands progressively through its bootstrap instructions. | A 1MCP MCP-server entry in Codex. |
| Direct HTTP | A trusted project only needs the aggregate 1MCP MCP endpoint. | `1mcp proxy` for the same project. |
| Stdio proxy | The project needs `.1mcprc` preset/filter selection or a stdio bridge. | The direct HTTP entry for the same project. |

All examples below use the default 1MCP port, `3050`. Replace it consistently when `1mcp serve` runs on another port.

## CLI Mode

CLI mode is the 1MCP workflow for instruction, discovery, and invocation without registering 1MCP itself as a Codex MCP server:

```bash
1mcp cli-setup --codex
```

The command installs the 1MCP Codex bootstrap files and prints the required Codex `config.toml` hook and sandbox change. Apply the printed snippet before starting a new Codex session. Keep the session workflow explicit:

```bash
1mcp instructions
1mcp inspect <server>
1mcp inspect <server>/<tool>
1mcp run <server>/<tool> --args '<json>'
```

Remove any existing 1MCP MCP-server entry from the same Codex scope before using this mode.

## Direct HTTP

Use direct HTTP for the simplest trusted-project MCP connection. Start the 1MCP runtime, then place this entry in the project's trusted `.codex/config.toml` (or the user configuration for a personal default):

```bash
1mcp serve
```

```toml
[mcp_servers.1mcp]
url = "http://localhost:3050/mcp"
```

Restart or open a new Codex session after changing its configuration. This path uses the aggregate endpoint directly; it does not apply `.1mcprc` preset or filter selection.

## Stdio Proxy

Use the proxy when `.1mcprc` selection is required. From the project root, create the selection file and configure only the proxy entry:

```json
// .1mcprc
{
  "preset": "codex-development"
}
```

```bash
1mcp preset create codex-development --filter "files OR git OR collaboration"
1mcp serve
```

```toml
# trusted project's .codex/config.toml
[mcp_servers.1mcp]
command = "npx"
args = ["-y", "@1mcp/agent", "proxy", "--url", "http://localhost:3050/mcp"]
```

Start Codex from that project root so the proxy reads the matching `.1mcprc`. Do not add the direct HTTP entry as well.

## Verify the Chosen Mode

Check the runtime before troubleshooting Codex:

```bash
curl http://localhost:3050/health
1mcp mcp status
```

For direct HTTP or proxy mode, start a new Codex session and inspect the configured MCP server. For CLI mode, run `1mcp instructions` and follow the returned server and tool inspection path. If the runtime uses authentication, configure the appropriate MCP client authentication for the endpoint; proxy and CLI mode do not bypass that runtime policy.

Related guides: [CLI Mode](/guide/integrations/cli-mode), [Proxy Command](/commands/proxy), and [Authentication](/guide/advanced/authentication).
