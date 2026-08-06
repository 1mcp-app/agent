---
title: app backups 命令
description: 列出、清理和验证应用整合过程中创建的配置备份。
---

# app backups

管理在整合过程中创建的配置备份。

有关备份和恢复系统的完整概述，请参阅 **[应用整合指南](../../guide/integrations/app-consolidation#backup-and-restore-system)**。

## 摘要

```bash
npx -y @1mcp/agent app backups [app-name] [options]
```

## 参数

- **`[app-name]`**
  - 您想要管理备份的应用程序。如果省略，它将管理所有应用的备份。

## 选项

- **`--cleanup <days>`**
  - 删除所有超过指定天数的备份。

- **`--verify`**
  - 验证备份文件的完整性。

## 示例

```bash
# 列出所有可用的备份
npx -y @1mcp/agent app backups

# 列出特定应用的备份
npx -y @1mcp/agent app backups claude-desktop

# 删除所有超过30天的备份
npx -y @1mcp/agent app backups --cleanup=30

# 验证所有备份的完整性
npx -y @1mcp/agent app backups --verify
```

## 另请参阅

- **[应用整合指南](../../guide/integrations/app-consolidation#backup-and-restore-system)**
