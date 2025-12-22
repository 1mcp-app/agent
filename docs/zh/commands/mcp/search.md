---
title: MCP 搜索命令 - 注册表服务器发现
description: 搜索 MCP 注册表中可用的服务器。此命令是 'registry search' 的别名，提供快速访问服务器发现功能。
head:
  - ['meta', { name: 'keywords', content: 'MCP 搜索,注册表服务器发现,服务器浏览,筛选' }]
  - ['meta', { property: 'og:title', content: '1MCP 搜索命令 - 注册表服务器发现' }]
  - ['meta', { property: 'og:description', content: '搜索 MCP 注册表中可用的服务器，支持筛选选项。' }]
---

# mcp search

搜索 MCP 注册表中可用的服务器。此命令是 `registry search` 命令的**便利别名**，选项有限。如需高级筛选和选项，请直接使用[注册表搜索](../registry/search.md)。

## 概述

按查询搜索服务器：

```bash
npx -y @1mcp/agent mcp search <query>
```

浏览所有可用服务器：

```bash
npx -y @1mcp/agent mcp search
```

## 参数

`<query>` (可选)
: 用于匹配服务器名称、描述和标签的搜索查询字符串。

## 限制

由于这是 `registry search` 的别名，它只支持基本的搜索功能。高级筛选选项如 `--status`、`--type`、`--transport` 和 `--format` 仅在完整的[注册表搜索](../registry/search.md)命令中可用。

## 示例

### 基本搜索

搜索与数据库相关的服务器：

```bash
npx -y @1mcp/agent mcp search database
```

### 浏览所有服务器

列出所有可用的服务器：

```bash
npx -y @1mcp/agent mcp search
```

## 另请参阅

- **[注册表搜索](../registry/search.md)** - 具有高级选项的完整注册表搜索命令
- **[注册表命令](../registry/)** - 完整的注册表命令文档
- **[mcp install](install.md)** - 安装通过搜索找到的服务器
