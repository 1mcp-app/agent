---
title: MCP Add 命令 - 添加服务器配置
description: 使用 mcp add 命令向 1MCP 配置添加新 MCP 服务器。了解 STDIO 和 HTTP 传输、标签和配置选项。
head:
  - ['meta', { name: 'keywords', content: 'mcp add 命令,添加服务器,STDIO 传输,HTTP 传输,标签' }]
  - ['meta', { property: 'og:title', content: '1MCP Add 命令参考' }]
  - ['meta', { property: 'og:description', content: '使用 mcp add 命令向 1MCP 配置添加 MCP 服务器。' }]
---

# mcp add

向 1MCP 配置中添加一个新的 MCP 服务器。

有关服务器管理的完整概述，请参阅 **[服务器管理指南](../../guide/essentials/server-management)**。

## 摘要

```bash
# 标准语法
npx -y @1mcp/agent mcp add <name> --type <type> [options]

# 使用“ -- ”模式的快速语法（自动检测类型为 stdio）
npx -y @1mcp/agent mcp add <name> [options] -- <command> [args...]
```

## 参数

- **`<name>`**
  - 新服务器的唯一名称。
  - **必需**：是

## 全局选项

此命令支持所有全局选项：

- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

## 命令特定选项

- **`--type <type>`**
  - 服务器的传输类型。
  - **必需**：是（或在使用" -- "模式时自动检测）
  - **值**：`stdio`、`http`

- **`--command <command>`**
  - 为 `stdio` 服务器执行的命令。
  - **`stdio` 必需**

- **`--args <args>`**
  - `stdio` 命令的逗号分隔的参数列表。

- **`--url <url>`**
  - `http` 服务器的 URL。
  - **`http` 必需**

- **`--tags <tags>`**
  - 用于组织的逗号分隔的标签列表。

- **`--env <key=value>`**
  - `stdio` 服务器的环境变量。可以多次指定。

- **`--timeout <ms>`**
  - 连接超时（以毫秒为单位）。

- **`--disabled`**
  - 添加服务器但保持禁用状态。

- **`--cwd <path>`**
  - `stdio` 服务器的工作目录。

- **`--headers <key=value>`**
  - `http`/`sse` 服务器的 HTTP 标头。可以多次指定。

- **`--restart-on-exit`**
  - 为 `stdio` 服务器启用进程退出时自动重启（仅限 stdio）。

- **`--max-restarts <number>`**
  - 最大重启尝试次数（仅限 stdio，如果未指定则无限制）。

- **`--restart-delay <ms>`**
  - 重启尝试之间的延迟（以毫秒为单位）（仅限 stdio，默认：1000）。

## 示例

### 标准语法

```bash
# 添加一个本地文件系统服务器
npx -y @1mcp/agent mcp add files --type=stdio --command="mcp-server-fs" --args="--root,./"

# 添加一个带有标签的远程 HTTP 服务器
npx -y @1mcp/agent mcp add remote-api --type=http --url="https://api.example.com/mcp" --tags="api,prod"

# 添加禁用状态的服务器
npx -y @1mcp/agent mcp add test-server --type=stdio --command="echo" --args="test" --disabled

# 添加具有重启配置的服务器
npx -y @1mcp/agent mcp add my-server --type=stdio --command="node" --args="server.js" --restart-on-exit --max-restarts=3 --restart-delay=2000

# 添加具有工作目录的服务器
npx -y @1mcp/agent mcp add local-server --type=stdio --command="pwd" --cwd="/tmp"

# 添加具有标头的 HTTP 服务器
npx -y @1mcp/agent mcp add auth-server --type=http --url="https://api.example.com/mcp" --headers="Authorization=Bearer token"
```

### 快速“ -- ”模式语法

```bash
# 使用“ -- ”模式添加服务器（类型自动检测为 stdio）
npx -y @1mcp/agent mcp add airtable --env AIRTABLE_API_KEY=your_key -- npx -y airtable-mcp-server

# 使用 Windows 命令包装器添加服务器
npx -y @1mcp/agent mcp add my-server -- cmd /c npx -y @some/package

# 将环境变量与“ -- ”模式结合使用
npx -y @1mcp/agent mcp add context7 --env API_TOKEN=secret --tags=ai,tools -- npx -y @context7/server
```

## 另请参阅

- **[服务器管理指南](../../guide/essentials/server-management)**
