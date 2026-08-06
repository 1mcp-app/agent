---
title: App 命令
description: 浏览用于发现、整合、恢复和检查桌面应用 MCP 配置的命令。
---

# App 命令

`app` 命令组可帮助您将来自各种桌面应用程序的 MCP 服务器配置整合到一个统一的 1MCP 代理中。

有关整合工作流程、支持的应用程序和最佳实践的完整概述，请参阅 **[应用程序整合指南](../../guide/integrations/app-consolidation)**。

## 命令

### [consolidate](./consolidate)

将来自桌面应用程序的 MCP 服务器整合到 1MCP 中。

```bash
npx -y @1mcp/agent app consolidate claude-desktop cursor vscode
```

### [restore](./restore)

将桌面应用程序恢复到其整合前的状态。

```bash
npx -y @1mcp/agent app restore claude-desktop
```

### [list](./list)

列出支持的桌面应用程序及其配置状态。

```bash
npx -y @1mcp/agent app list
```

### [discover](./discover)

发现已安装的具有 MCP 配置的应用程序。

```bash
npx -y @1mcp/agent app discover
```

### [status](./status)

显示您的应用程序的当前整合状态。

```bash
npx -y @1mcp/agent app status
```

### [backups](./backups)

列出和管理配置备份。

```bash
npx -y @1mcp/agent app backups --cleanup=30
```
