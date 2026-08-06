---
title: mcp enable 和 disable 命令
description: 在不删除配置的情况下启用或禁用 MCP 服务器。
---

# mcp enable / disable

启用或禁用 MCP 服务器，而无需删除其配置。

有关服务器管理的完整概述，请参阅 **[服务器管理指南](../../guide/essentials/server-management)**。

## 摘要

```bash
npx -y @1mcp/agent mcp enable <name>
npx -y @1mcp/agent mcp disable <name>
```

## 参数

- **`<name>`**
  - 要启用或禁用的服务器的名称。
  - **必需**：是

## 描述

禁用服务器是一种非破坏性的方式，可以暂时将其从可用 MCP 服务器池中移除。这对于维护或调试非常有用，而不会丢失服务器的配置。

## 示例

```bash
# 禁用服务器
npx -y @1mcp/agent mcp disable my-server

# 稍后重新启用服务器
npx -y @1mcp/agent mcp enable my-server
```

## 另请参阅

- **[服务器管理指南](../../guide/essentials/server-management)**
