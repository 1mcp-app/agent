---
title: 注册表命令
description: 1MCP 注册表发现命令参考。
head:
  - ['meta', { name: 'keywords', content: '1MCP 注册表,MCP 注册表命令,注册表搜索,注册表状态' }]
  - ['meta', { property: 'og:title', content: '1MCP 注册表命令' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: '使用 1MCP 的 search、status、show 和 versions 命令查询已配置的 MCP 注册表。',
      },
    ]
---

# 注册表命令

使用 `registry` 查询已配置的 MCP 注册表。该命令组只有四个子命令：`search`、`status`、`show` 和 `versions`。

```bash
1mcp registry <subcommand> [options]
```

## 共享注册表选项

所有注册表子命令在需要时都可使用以下传输选项：

- `--url <url>`：注册表基础 URL。
- `--timeout <ms>`：注册表请求超时。
- `--cache-ttl <seconds>`、`--cache-max-size <number>`、`--cache-cleanup-interval <ms>`：进程内缓存设置。
- `--proxy <url>`、`--proxy-auth <username:password>`：注册表请求的 HTTP 代理设置。

## 命令

- [search](/zh/commands/registry/search)：按文本、状态、包类型或传输方式查找注册表条目。
- [status](/zh/commands/registry/status)：检查注册表可用性和可选计数。
- [show](/zh/commands/registry/show)：查看一个注册表条目。
- [versions](/zh/commands/registry/versions)：列出一个注册表条目的版本。

## 常见查询

```bash
1mcp registry search filesystem --type npm --transport stdio
1mcp registry show io.github.containers/kubernetes-mcp-server
1mcp registry versions io.github.containers/kubernetes-mcp-server --format json
```

使用 `search` 返回的精确注册表 ID 配合 [mcp install](/zh/commands/mcp/install)。该命令组不包含注册表配置、登录、私有注册表管理、清除缓存或更新命令。
