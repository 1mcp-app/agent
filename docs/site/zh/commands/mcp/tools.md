---
title: MCP Tools 命令 - 禁用单个工具
description: 列出、禁用和重新启用已配置 MCP 服务器上的单个工具，而不禁用整个服务器。
head:
  - ['meta', { name: 'keywords', content: 'mcp tools,disabledTools,禁用工具,启用工具,工具过滤' }]
  - ['meta', { property: 'og:title', content: '1MCP Tools 命令参考' }]
  - ['meta', { property: 'og:description', content: '列出、禁用和重新启用已配置 MCP 服务器上的单个工具。' }]
---

# mcp tools

管理每个服务器的禁用工具列表。

当某个服务器整体仍然有用，但其中一个或多个工具不应出现在 `inspect`、`run`、直接 MCP 客户端或懒加载工具流程中时，使用此命令。

## 摘要

```bash
npx -y @1mcp/agent mcp tools
npx -y @1mcp/agent mcp tools list [server] [--disabled]
npx -y @1mcp/agent mcp tools disable <server> <tool>
npx -y @1mcp/agent mcp tools enable <server> <tool>
```

## 描述

`mcp tools` 会打开带有 token 估算的交互式工具浏览器。`list`、`disable` 和 `enable` 子命令是仅修改配置的命令，会更新 `mcp.json` 中目标服务器的 `disabledTools` 数组。

如果 `1mcp serve` 已经在运行，它会通过配置热重载观察到 `mcp.json` 的变化。可以使用下面的命令确认当前状态：

```bash
npx -y @1mcp/agent mcp tools list <server> --disabled
```

## 参数

- **`[server]`**
  - `list` 的可选服务器名称。
  - `enable` 和 `disable` 必填。

- **`<tool>`**
  - 要启用或禁用的精确服务器本地工具名。
  - `enable` 和 `disable` 必填。

## 选项

- **`--server <server>`**
  - 直接为一个服务器打开交互式浏览器。

- **`--model <model>`**
  - 交互模式中用于 token 估算的模型。

- **`--disabled`**
  - 与 `list` 一起使用时，显示禁用工具名称而不是数量。

## 示例

```bash
# 打开交互式工具浏览器
npx -y @1mcp/agent mcp tools

# 显示所有服务器的禁用工具数量
npx -y @1mcp/agent mcp tools list

# 显示一个服务器的禁用工具
npx -y @1mcp/agent mcp tools list filesystem --disabled

# 禁用一个工具，但不禁用整个服务器
npx -y @1mcp/agent mcp tools disable filesystem write_file

# 稍后重新启用该工具
npx -y @1mcp/agent mcp tools enable filesystem write_file
```

## 配置行为

禁用工具按服务器存储：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "disabledTools": ["write_file"]
    }
  }
}
```

请在 `disabledTools` 中使用逻辑上的服务器本地工具名，例如 `write_file`。运行时过滤也能识别 `filesystem_1mcp_write_file` 这样的限定名称，但逻辑名称更容易阅读和维护。

当同名服务器同时存在于 `mcpTemplates` 和 `mcpServers` 中时，1MCP 以模板条目为准。`mcp tools enable` 和 `mcp tools disable` 会更新 `mcpTemplates.<name>.disabledTools`，并保留任何旧的 `mcpServers.<name>.disabledTools` 值不变。

## 另请参阅

- **[mcp enable / disable](/zh/commands/mcp/enable-disable)** - 启用或禁用整个服务器
- **[mcp list](/zh/commands/mcp/list)** - 列出已配置的服务器
- **[MCP 服务器参考](/zh/reference/mcp-servers)** - 服务器配置字段
