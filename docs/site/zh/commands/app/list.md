---
title: app list 命令
description: 列出支持 MCP 整合的桌面应用及其配置能力。
---

# app list

列出应用程序整合功能支持的所有桌面应用程序。

有关应用程序及其状态的完整列表，请参阅 **[应用程序整合指南](/zh/guide/integrations/app-consolidation#受支持的应用)**。

## 摘要

```bash
1mcp app list [options]
```

## 全局选项

此命令支持所有全局选项：

- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

## 命令特定选项

- **`--configurable-only`**
  - 仅显示支持自动整合的应用程序。

- **`--manual-only`**
  - 仅显示需要手动设置的应用程序。

## 示例

```bash
# 列出所有支持的应用程序
1mcp app list

# 仅列出可以自动配置的应用程序
1mcp app list --configurable-only
```

## 另请参阅

- **[应用程序整合指南](/zh/guide/integrations/app-consolidation)**
