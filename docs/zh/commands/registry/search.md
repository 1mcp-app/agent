---
title: 注册表搜索命令 - 服务器发现
description: 按名称、类别、标签或功能在 1MCP 注册表中搜索 MCP 服务器。筛选结果并找到符合您特定要求的服务器。
head:
  - ['meta', { name: 'keywords', content: 'MCP 注册表搜索,服务器发现,筛选,服务器查找' }]
  - ['meta', { property: 'og:title', content: '1MCP 注册表搜索命令 - 服务器发现' }]
  - ['meta', { property: 'og:description', content: '在 1MCP 注册表中搜索 MCP 服务器，具有高级筛选和发现功能。' }]
---

# registry search

使用各种筛选条件和标准在 1MCP 注册表中搜索 MCP 服务器。按名称、类别、标签或功能查找服务器，支持高级筛选选项。

## 概述

按名称或关键字搜索服务器：

```bash
npx -y @1mcp/agent registry search <query>
```

浏览所有可用服务器：

```bash
npx -y @1mcp/agent registry search
```

按传输类型筛选：

```bash
npx -y @1mcp/agent registry search --transport=stdio
```

使用多个标准的高级筛选：

```bash
npx -y @1mcp/agent registry search database --type=npm --format=json
```

## 参数

`<query>` (可选)
: 要与服务器名称、描述和标签匹配的搜索查询字符串。支持部分匹配和模糊搜索。

## 全局选项

- **`--config, -c <路径>`** - 指定配置文件路径
- **`--config-dir, -d <路径>`** - 配置目录路径

## 命令特定选项

- **`--status <状态>`**
  - 按服务器状态筛选
  - **选择**：`active`、`archived`、`deprecated`、`all`
  - **默认**：`active`

- **`--type <类型>`**
  - 按包注册表类型筛选
  - **选择**：`npm`、`pypi`、`docker`

- **`--transport <传输>`**
  - 按传输方式筛选
  - **选择**：`stdio`、`sse`、`http`

- **`--limit <数字>`**
  - 返回的最大结果数
  - **默认**：`20`
  - **最大值**：`100`

- **`--cursor <字符串>`**
  - 用于检索下一页结果的分页游标

- **`--format <格式>`**
  - 搜索结果的输出格式
  - **选择**：`table`、`list`、`json`
  - **默认**：`table`

## 示例

### 基本搜索

搜索与文件系统相关的服务器：

```bash
npx -y @1mcp/agent registry search filesystem

# 输出:
# 🔍 搜索结果："filesystem"
#
# 名称              | 类别      | 版本  | 描述
# ----------------- | --------- | ----- | -----------------------------------------
# filesystem        | 系统      | 1.2.0 | 文件系统访问和管理
# ftp               | 网络      | 1.0.1 | FTP/SFTP 文件操作
# cloud-storage     | 存储      | 2.1.0 | 云存储集成 (S3, GCS)
# backup            | 系统      | 1.5.2 | 文件备份和同步
#
# 找到 4 个结果（显示 4 个，共 4 个）
```

### 按传输方式筛选

查找使用 stdio 传输的服务器：

```bash
npx -y @1mcp/agent registry search --transport=stdio

# 输出:
# 🗃️  数据库服务器
#
# 名称              | 维护者             | 版本  | 下载量 | 描述
# ----------------- | ------------------ | ----- | ------- | -------------------------
# postgresql        | MCP 团队           | 2.0.1 | 15.2k   | PostgreSQL 数据库操作
# mongodb           | MongoDB MCP        | 1.3.0 | 8.7k    | MongoDB 数据库访问
# mysql             | MySQL 社区         | 1.8.2 | 12.1k   | MySQL 数据库连接
# redis             | Redis 实验室       | 1.2.1 | 9.4k    | Redis 缓存操作
# sqlite            | SQLite 团队        | 2.1.0 | 18.3k   | SQLite 数据库管理
#
# 找到 5 个结果
```

### 标签筛选

搜索具有特定标签的服务器：

```bash
npx -y @1mcp/agent registry search --tag=api --tag=rest

# 输出:
# 🔍 标记为：api, rest 的服务器
#
# 名称              | 类别      | 版本  | 描述
# ----------------- | --------- | ----- | -----------------------------------------
# http-client       | 网络      | 1.5.0 | HTTP/REST API 客户端
# api-gateway       | 开发      | 1.2.1 | API 网关和管理
# rest-tools        | 开发      | 1.0.3 | REST API 开发工具
# web-scraping      | Web       | 2.0.1 | REST API 的网络抓取
#
# 找到 4 个结果
```

### 高级筛选

结合多个筛选条件获得精确结果：

```bash
npx -y @1mcp/agent registry search \
  --category=development \
  --platform=linux \
  --transport=stdio \
  --trusted \
  --sort=popularity \
  --limit=5

# 输出:
# 🔍 开发服务器 (Linux, stdio, 受信任)
#
# 名称              | 版本  | 下载量 | 描述
# ----------------- | ----- | ------- | -----------------------------------------
# git               | 3.1.0 | 25.4k   | Git 仓库操作
# docker            | 2.0.1 | 18.7k   | Docker 容器管理
# npm               | 1.8.0 | 14.2k   | Node.js 包管理
# python            | 2.2.1 | 16.9k   | Python 开发工具
# terraform         | 1.5.0 | 9.8k    | Terraform 基础设施
#
# 找到 5 个结果（共 23 个）
```

### 已安装服务器

仅显示您已安装的服务器：

```bash
npx -y @1mcp/agent registry search --installed

# 输出:
# 📦 已安装服务器
#
# 名称              | 已安装  | 最新  | 状态     | 描述
# ----------------- | ------- | ----- | -------- | -------------------------
# filesystem        | 1.2.0   | 1.2.1 | ⬆️ 更新 | 文件系统访问
# git               | 3.1.0   | 3.1.0 | ✓ 当前   | Git 操作
# search            | 1.0.2   | 1.1.0 | ⬆️ 更新 | 网络搜索功能
#
# 已安装 3 个服务器，2 个有可用更新
```

### 有更新可用的服务器

查找可以更新的服务器：

```bash
npx -y @1mcp/agent registry search --updates

# 输出:
# 🔄 可用更新
#
# 服务器       | 当前   | 最新  | 类型     | 更改
# ------------ | ------ | ----- | -------- | ------------------------
# filesystem   | 1.2.0  | 1.2.1 | 补丁     | 错误修复，性能
# search       | 1.0.2  | 1.1.0 | 次要     | 新功能，API
# database     | 2.0.1  | 3.0.0 | 主要     | 破坏性更改，新 API
#
# 3 个更新可用
```

### JSON 输出

获取机器可读的结果：

```bash
npx -y @1mcp/agent registry search database --output=json

# 输出:
# {
#   "query": "database",
#   "total": 5,
#   "results": [
#     {
#       "name": "postgresql",
#       "displayName": "PostgreSQL Server",
#       "description": "PostgreSQL database operations and queries",
#       "version": "2.0.1",
#       "category": "Database",
#       "tags": ["database", "postgresql", "sql"],
#       "maintainer": "MCP Team",
#       "downloads": 15200,
#       "trustLevel": "verified",
#       "platforms": ["linux", "darwin", "win32"],
#       "transport": ["stdio"],
#       "lastUpdated": "2024-01-10T15:30:00Z"
#     }
#   ]
# }
```

### 详细输出

显示全面的服务器信息：

```bash
npx -y @1mcp/agent registry search git --detailed --limit=1

# 输出:
# 🔍 详细信息：git
#
# Git 仓库操作服务器
# ================
#
# 版本：3.1.0
# 类别：开发
# 维护者：MCP 团队
# 许可证：MIT
#
# 描述：
#   提供包括提交、分支、合并和文件历史管理在内的 Git 仓库操作。
#   支持本地和远程仓库。
#
# 功能：
#   • 工具：git_status, git_add, git_commit, git_push, git_pull, git_branch
#   • 资源：仓库文件，Git 历史
#
# 要求：
#   • Git 命令行工具
#   • 仓库文件的读取访问权限
#   • 仓库修改的写入权限
#
# 平台：Linux、macOS、Windows
# 传输：stdio
# 下载量：25,400
# 最后更新：2024-01-12
#
# 安装：
#   npx -y @1mcp/agent mcp install git
```

## 搜索语法

### 查询格式

搜索查询支持灵活匹配：

```bash
# 精确名称匹配
registry search filesystem

# 部分名称匹配
registry search file

# 描述匹配
registry search "file system"

# 标签匹配
registry search storage

# 模糊匹配
registry search flsystm  # 匹配 "filesystem"
```

### 特殊操作符

使用特殊操作符进行高级搜索：

```bash
# 精确短语匹配
registry search "file system access"

# 排除术语
registry search database --not=mysql

# 通配符匹配
registry search py*  # 匹配 python、pytorch 等

# 正则表达式
registry search --regex="^(git|svn|hg)$"
```

## 类别和标签

### 可用类别

- **系统** - 文件系统、备份、实用程序
- **数据库** - 数据库服务器和客户端
- **开发** - 构建工具、版本控制
- **Web** - HTTP 客户端、网络抓取
- **网络** - 网络协议、API
- **存储** - 云存储、对象存储
- **通信** - 电子邮件、聊天、通知
- **数据处理** - 分析、机器学习、ETL
- **安全** - 身份验证、加密
- **监控** - 日志、指标、警报

### 常用标签

- **传输**：stdio、http、sse
- **平台**：linux、darwin、win32、web
- **功能**：api、cli、gui、batch
- **语言**：python、javascript、go、rust
- **环境**：development、production、testing
- **安全**：trusted、verified、sandboxed

## 排序和分页

### 排序选项

```bash
# 按受欢迎程度排序（下载量最多）
registry search --sort=popularity

# 按最近更新排序
registry search --sort=updated

# 按名称排序（字母顺序）
registry search --sort=name

# 按创建日期排序
registry search --sort=created

# 按下载次数排序
registry search --sort=downloads
```

### 分页

控制结果显示：

```bash
# 限制结果
registry search --limit=10

# 跳过前 N 个结果
registry search --offset=20

# 显示所有结果（最多 100 个）
registry search --limit=100
```

## 注册表缓存

搜索结果被缓存以提高性能：

```bash
# 强制刷新缓存
registry search --refresh

# 检查缓存状态
registry status --cache

# 清除缓存
registry cache --clear
```

## 集成示例

### 管道安装

搜索和安装服务器：

```bash
# 搜索并安装第一个结果
registry search database --limit=1 --output=json | \
  jq -r '.results[0].name' | \
  xargs npx -y @1mcp/agent mcp install

# 安装所有数据库服务器
registry search --category=database --output=list | \
  xargs -n1 npx -y @1mcp/agent mcp install
```

### 更新检查自动化

在脚本中检查更新：

```bash
#!/bin/bash
# 检查有更新可用的服务器
updates=$(registry search --updates --output=json)
count=$(echo "$updates" | jq '.total')

if [ "$count" -gt 0 ]; then
  echo "发现 $count 个可用更新："
  echo "$updates" | jq -r '.results[] | "  • \(.name): \(.current) → \(.latest)"'

  # 询问用户是否要更新
  read -p "更新所有服务器？(y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    registry search --updates --output=list | \
      xargs -n1 npx -y @1mcp/agent mcp update
  fi
fi
```

## 另请参阅

- **[mcp install](../mcp/install.md)** - 从搜索结果安装服务器
- **[服务器管理指南](../../guide/essentials/server-management.md)** - 服务器管理概述
