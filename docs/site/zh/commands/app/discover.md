---
title: app discover 命令
description: 扫描受支持桌面应用中的可检测 MCP 配置。
---

# app discover

发现已安装的具有 MCP 配置的桌面应用程序。

此命令会扫描您的系统以查找支持的应用程序，并报告哪些应用程序具有可检测的 MCP 服务器配置。

有关整合工作流程的完整概述，请参阅 **[应用程序整合指南](../../guide/integrations/app-consolidation)**。

## 摘要

```bash
npx -y @1mcp/agent app discover [options]
```

## 选项

- **`--show-empty`**
  - 包括已找到但未配置 MCP 服务器的支持的应用程序。

- **`--show-paths`**
  - 显示发现的配置文件的文件路径。

## 示例

```bash
# 发现所有已安装的具有 MCP 配置的应用程序
npx -y @1mcp/agent app discover

# 包括具有配置文件但没有服务器的应用程序
npx -y @1mcp/agent app discover --show-empty
```

## 另请参阅

- **[应用程序整合指南](../../guide/integrations/app-consolidation#the-consolidation-workflow)**
