---
title: 内部工具
description: 1MCP 内部管理工具的 MCP 协议参考。
---

# 内部工具

内部工具是运行中 1MCP 服务器可选暴露的 MCP 工具，用于程序化服务器管理。它们不是 CLI 命令。只为连接的 MCP 客户端启用所需类别。

```bash
1mcp serve --enable-internal-tools
1mcp serve --internal-tools discovery,management
```

## 工具分组

- [发现工具](/zh/reference/internal-tools/discovery)：`mcp_search`、`mcp_registry_status`、`mcp_registry_info`、`mcp_registry_list` 和 `mcp_info`。
- [安装工具](/zh/reference/internal-tools/installation)：`mcp_install`、`mcp_uninstall` 和 `mcp_update`。
- [管理工具](/zh/reference/internal-tools/management)：`mcp_enable`、`mcp_disable`、`mcp_list`、`mcp_status`、`mcp_edit` 和 `mcp_reload`。

## 已初始化的 MCP 请求示例

在有状态的 MCP 连接上，先发送 `initialize`，再发送 `notifications/initialized` 通知，最后发送 `tools/call` 请求。以下消息使用当前协议版本，以及 `mcp_install` 的参数名 `name`：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"example-client","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mcp_install","arguments":{"name":"project-dependencies","package":"@scope/project-mcp","command":"npx","args":["-y","@scope/project-mcp"]}}}
```

在调用工具前，在已初始化连接上使用 `tools/list` 获取当前精确 schema。安装和管理操作可能更改运行时配置。

交互式管理请使用 [MCP CLI 命令](/zh/commands/mcp/)。
