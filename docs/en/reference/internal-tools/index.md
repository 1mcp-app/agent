---
title: Internal Tools
description: MCP protocol reference for 1MCP internal management tools.
---

# Internal Tools

Internal Tools are optional MCP tools exposed by a running 1MCP server for programmatic server management. They are not CLI commands. Enable only the categories required by the connecting MCP client.

```bash
1mcp serve --enable-internal-tools
1mcp serve --internal-tools discovery,management
```

## Tool Groups

- [Discovery Tools](/reference/internal-tools/discovery): `mcp_search`, `mcp_registry_status`, `mcp_registry_info`, `mcp_registry_list`, and `mcp_info`.
- [Installation Tools](/reference/internal-tools/installation): `mcp_install`, `mcp_uninstall`, and `mcp_update`.
- [Management Tools](/reference/internal-tools/management): `mcp_enable`, `mcp_disable`, `mcp_list`, `mcp_status`, `mcp_edit`, and `mcp_reload`.

## Initialized MCP Request Example

On a stateful MCP connection, send `initialize`, then the `notifications/initialized` notification, before a `tools/call` request. The following messages use the current protocol version and the `mcp_install` argument name `name`:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"example-client","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mcp_install","arguments":{"name":"project-dependencies","package":"@scope/project-mcp","command":"npx","args":["-y","@scope/project-mcp"]}}}
```

Use `tools/list` on the initialized connection to obtain the exact current schemas before calling a tool. Installation and management operations can change runtime configuration.

For interactive administration, use the [MCP CLI commands](/commands/mcp/) instead.
