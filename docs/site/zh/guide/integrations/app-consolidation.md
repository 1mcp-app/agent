---
title: 应用整合指南
description: 将受支持应用的 MCP 配置整合到 1MCP，并从集中备份中恢复。
head:
  - ['meta', { name: 'keywords', content: '1MCP 应用整合,MCP 配置备份,Claude Desktop,Cursor' }]
  - ['meta', { property: 'og:title', content: '1MCP 应用整合指南' }]
  - ['meta', { property: 'og:description', content: '通过预览、备份和恢复，将受支持应用的 MCP 配置整合到 1MCP。' }]
---

# 应用整合指南

应用整合会将客户端已配置的 MCP 服务器导入 1MCP，写入该客户端连接 1MCP 所需的配置，并创建可恢复的备份。请先执行发现和预览：

```bash
1mcp app discover
1mcp app consolidate claude-desktop --dry-run
1mcp app consolidate claude-desktop
1mcp app status claude-desktop
```

整合前请关闭目标客户端。每次只处理一个客户端，并在变更后测试它。

## 受支持的应用

`APP_PRESETS` 是 `app` 命令的事实来源。当前可自动配置的条目为：

- `claude-desktop`、`cursor`、`vscode`、`claude-code`、`gemini-code`、`augment-code`、`roo-code` 和 `cline`。

`cherry-studio` 和 `continue` 通过 `app consolidate` 输出的手动说明得到支持，不会被自动编辑。GitHub Copilot 不是 `APP_PRESETS` 目标，不应被描述为受支持的整合路径。

在目标机器上运行 `1mcp app list` 或 `1mcp app discover --show-paths`，查看可用预设和检测到的位置。

## 备份和恢复

整合会将备份集中存储在 1MCP 全局配置根目录下的 `<global-config-dir>/backups/<app-name>/`。使用默认全局根目录时，macOS 和 Linux 为 `~/.config/1mcp/backups/<app-name>/`，Windows 为 `%APPDATA%\1mcp\backups\<app-name>\`。该位置不受 `--config-dir` 影响。已有的旧备份仍可被发现，但新的整合备份使用集中位置。

```bash
1mcp app backups
1mcp app backups claude-desktop --verify
1mcp app restore claude-desktop
1mcp app restore --all
```

仅在确认不再需要备份后，才使用 `1mcp app backups --cleanup=30`。该命令会删除早于指定天数的备份。

## 故障排除

- `app discover` 没有找到配置：先运行一次客户端，再用 `app discover --show-paths` 将预期位置与本机安装比较。
- 整合无法写入目标：关闭客户端，并确认当前用户能写入其配置文件。
- 客户端之后无法连接：启动 `1mcp serve`，然后使用 `curl http://localhost:3050/health` 检查默认端点（或使用已配置端口）。

准确的命令选项请参阅[应用命令](/zh/commands/app/)。
