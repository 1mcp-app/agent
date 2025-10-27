---
title: 应用程序整合指南 - 统一多个桌面应用配置
description: 将 Claude Desktop、Cursor 和其他桌面应用程序的 MCP 服务器配置整合到单个 1MCP 实例中。分步整合指南。
head:
  - ['meta', { name: 'keywords', content: '应用程序整合,桌面应用,配置管理,MCP 配置' }]
  - ['meta', { property: 'og:title', content: '1MCP 应用程序整合指南' }]
  - ['meta', { property: 'og:description', content: '将多个桌面应用的 MCP 服务器配置整合为一个 1MCP 实例。' }]
---

# 应用程序整合指南

本指南全面概述了 1MCP Agent 中的应用程序整合功能。它可帮助您将来自多个桌面应用程序的 MCP 服务器配置统一到一个可管理的 1MCP 实例中。

## 核心概念

许多桌面开发工具都使用自己的 MCP 服务器配置。单独管理这些配置效率低下，并且会阻止它们共享服务器资源。

**整合前：**

```
Claude Desktop → [filesystem, postgres] 服务器
Cursor → [github, database] 服务器
VS Code → [typescript, eslint] 服务器
```

**目标：**
应用程序整合通过将所有应用程序路由到单个 1MCP 代理来简化此过程。这使您的所有工具都可以访问所有服务器。

**整合后：**

```
Claude Desktop ↘
Cursor --------→ 1MCP → [filesystem, postgres, github, database, typescript, eslint]
VS Code -------↗
```

## 整合工作流程

该过程旨在安全且可逆。

1.  **发现**：查找已安装并具有 MCP 配置的支持的应用程序。
    ```bash
    npx -y @1mcp/agent app discover
    ```
2.  **整合**：预览然后执行整合。此命令从应用程序的配置中提取服务器，将其添加到 1MCP，并将应用程序的配置指向您的 1MCP 服务器。

    ```bash
    # 首先预览更改
    npx -y @1mcp/agent app consolidate claude-desktop --dry-run

    # 运行整合
    npx -y @1mcp/agent app consolidate claude-desktop
    ```

3.  **检查状态**：验证应用程序现在是否标记为“已整合”。
    ```bash
    npx -y @1mcp/agent app status claude-desktop
    ```

## 支持的应用程序

这是 `app` 命令支持的应用程序的最终列表。

### 可自动配置

这些应用程序支持全自动整合和恢复。1MCP 可以读取其配置文件，对其进行修改并安全地进行备份。

- **claude-desktop**：Claude 桌面应用程序
- **cursor**：Cursor 代码编辑器
- **vscode**：Visual Studio Code
- **roo-code**：Roo Code / Cline 扩展

### 需要手动设置

支持这些应用程序，但 1MCP 无法直接访问其配置。`consolidate` 命令将为您提供手动配置它们的分步说明。

- **cherry-studio**：Cherry Studio
- **continue**：Continue VS Code 扩展
- **copilot**：GitHub Copilot

## 备份和恢复系统

安全是整合功能的核心原则。1MCP 会在进行任何更改之前自动创建原始配置文件的备份。

### 备份如何工作

- **自动创建**：在 `consolidate` 过程中自动创建备份。
- **位置**：备份存储在与原始配置文件相同的目录中。
- **命名**：备份使用 `<original-filename>.backup.<timestamp>.meta` 格式命名。
- **内容**：备份文件是一个 JSON 对象，其中包含原始配置内容以及有关整合操作的元数据。

### 管理备份

您可以使用 `npx -y @1mcp/agent app backups` 命令管理所有备份。

- **列出所有备份**：`npx -y @1mcp/agent app backups`
- **列出特定应用程序的备份**：`npx -y @1mcp/agent app backups claude-desktop`
- **验证备份完整性**：`npx -y @1mcp/agent app backups --verify`
- **清理旧备份**：`npx -y @1mcp/agent app backups --cleanup=30`（删除超过 30 天的备份）

### 从备份中恢复

如果您需要撤消整合，可以轻松地恢复原始配置。

- **恢复应用程序的最新备份**：
  ```bash
  npx -y @1mcp/agent app restore claude-desktop
  ```
- **恢复所有已整合的应用程序**：
  ```bash
  npx -y @1mcp/agent app restore --all
  ```
- **从特定备份文件恢复**：
  ```bash
  npx -y @1mcp/agent app restore --backup /path/to/your/config.backup.1640995200000.meta
  ```

## 最佳实践

### 整合前

1.  确保您的 1MCP 服务器正在运行且可访问。
2.  使用 `npx -y @1mcp/agent app discover` 查看可以整合哪些应用程序。
3.  始终首先使用 `--dry-run` 标志预览更改，然后再应用它们。
4.  在运行 `consolidate` 命令之前关闭目标桌面应用程序。

### 整合期间

1.  一次开始整合一个应用程序。
2.  整合应用程序后，启动它并测试其功能。
3.  如果遇到问题，请设置 `ONE_MCP_LOG_LEVEL=debug` 以获取更详细的日志。

### 整合后

1.  验证所有预期的 MCP 服务器在整合的应用程序中都可用。
2.  定期使用 `npx -y @1mcp/agent app backups --cleanup <days>` 删除旧的、不需要的备份。

## 故障排除

### 找不到配置文件

- **原因**：应用程序可能未安装，或者从未运行过，因此其配置文件尚未创建。
- **解决方案**：确保应用程序已安装并至少运行一次。使用 `npx -y @1mcp/agent app discover --show-paths` 查看 1MCP 在哪里查找配置文件。

### 权限被拒绝

- **原因**：您可能没有对应用程序配置文件的必要写权限。
- **解决方案**：确保您使用具有正确权限的用户帐户运行该命令。在运行命令之前关闭应用程序，因为它可能会锁定文件。

### 1MCP 服务器未运行

- **原因**：`consolidate` 命令需要连接到正在运行的 1MCP 服务器以验证 URL。
- **解决方案**：使用 `npx -y @1mcp/agent serve` 启动您的 1MCP 服务器。您可以使用 `curl http://localhost:3051/health` 验证其状态（如果需要，请调整端口）。
