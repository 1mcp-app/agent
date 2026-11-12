---
title: app consolidate 命令
description: 将桌面应用的 MCP 配置导入统一的 1MCP 运行时。
---

# app consolidate

将桌面应用程序的 MCP 服务器整合到 1MCP 中。

此命令从应用程序的配置文件中提取 MCP 服务器配置，将其导入到您的 1MCP 配置中，并将应用程序的配置替换为到您的 1MCP 服务器的单个连接。

有关整合工作流程、支持的应用程序和最佳实践的完整概述，请参阅 **[应用程序整合指南](/zh/guide/integrations/app-consolidation)**。

## 摘要

```bash
1mcp app consolidate <app-name...> [options]
```

## 参数

- **`<app-name...>`**
  - 要整合的一个或多个桌面应用程序。
  - **必需**：是
  - 要查看支持的应用程序列表，请使用 `1mcp app list` 或参阅[应用程序整合指南](/zh/guide/integrations/app-consolidation#受支持的应用)。

## 选项

### 连接选项

- **`--url, -u <url>`** - 覆盖自动检测到的 1MCP 服务器 URL。

### 操作选项

- **`--dry-run`** - 预览所有更改而不修改任何文件。
- **`--yes, -y`** - 跳过所有确认提示。
- **`--force, -f`** - 跳过非关键验证警告。

### 模式选项

- **`--manual-only`** - 显示手动设置说明，而不是执行自动整合。
- **`--backup-only`** - 创建现有配置的备份，而不导入服务器或修改配置文件。

### 配置选项

- **`--config, -c <path>`** - 您的 1MCP 配置文件的路径。

## 示例

### 基本用法

```bash
# 整合 Claude Desktop
1mcp app consolidate claude-desktop

# 一次整合多个应用程序
1mcp app consolidate claude-desktop cursor vscode

# 预览应用程序的更改而不应用它们
1mcp app consolidate cursor --dry-run
```

### 高级用法

```bash
# 使用自定义 1MCP 服务器 URL
1mcp app consolidate claude-desktop --url=http://localhost:3052/mcp

# 跳过脚本的确认提示
1mcp app consolidate vscode --yes

# 获取应用程序的手动设置说明
1mcp app consolidate cherry-studio --manual-only
```

## 另请参阅

- **[应用程序整合指南](/zh/guide/integrations/app-consolidation)**
- **[app restore](/zh/commands/app/restore)** - 将应用程序恢复到其原始状态。
- **[app status](/zh/commands/app/status)** - 检查应用程序的整合状态。
