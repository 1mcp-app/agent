---
title: app restore 命令
description: 从整合前的备份恢复桌面应用 MCP 配置。
---

# app restore

使用备份文件将应用程序恢复到整合前的状态。

有关整合和恢复工作流程的完整概述，请参阅 **[应用程序整合指南](../../guide/integrations/app-consolidation)**。

## 摘要

```bash
npx -y @1mcp/agent app restore [app-name] [options]
```

## 参数

- **`[app-name]`**
  - 要恢复的应用程序的名称。如果省略，则必须使用 `--all` 或 `--backup`。

## 选项

- **`--all`**
  - 恢复所有具有备份的应用程序。

- **`--backup <path>`**
  - 从特定的备份元数据文件恢复。

- **`--list, -l`**
  - 列出指定应用程序的可用备份。

- **`--yes, -y`**
  - 跳过确认提示。

## 示例

```bash
# 恢复 Claude Desktop 的最新备份
npx -y @1mcp/agent app restore claude-desktop

# 恢复所有已整合的应用程序
npx -y @1mcp/agent app restore --all

# 列出 Cursor 的可用备份
npx -y @1mcp/agent app restore cursor --list
```

## 另请参阅

- **[应用程序整合指南](../../guide/integrations/app-consolidation#backup-and-restore-system)**
