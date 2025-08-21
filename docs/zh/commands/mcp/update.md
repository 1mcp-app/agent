# mcp update

更新现有 MCP 服务器的配置。

有关服务器管理的完整概述，请参阅 **[服务器管理指南](../../guide/essentials/server-management)**。

## 摘要

```bash
# 标准语法
npx -y @1mcp/agent mcp update <name> [options]

# 使用“ -- ”模式的快速语法（更新命令和参数）
npx -y @1mcp/agent mcp update <name> [options] -- <command> [args...]
```

## 参数

- **`<name>`**
  - 要更新的服务器的名称。
  - **必需**：是

## 选项

- **`--tags <tags>`**
  - 新的逗号分隔的标签列表。这将覆盖现有的标签。

- **`--env <key=value>`**
  - 添加或更新环境变量。可以多次指定。

- **`--timeout <ms>`**
  - 新的连接超时（以毫秒为单位）。

- **`--type <type>`**
  - 更改服务器的传输类型。
  - **值**：`stdio`、`http`、`sse`

- **`--command <command>`**、**`--args <args>`**、**`--url <url>`**
  - 您还可以更新服务器的核心属性。

- **`--cwd <path>`**
  - 更新 `stdio` 服务器的工作目录。

- **`--headers <key=value>`**
  - 更新 `http`/`sse` 服务器的 HTTP 标头。可以多次指定。

- **`--restart-on-exit`**
  - 启用或禁用进程退出时自动重启（仅限 `stdio` 服务器）。

- **`--max-restarts <number>`**
  - 更新最大重启尝试次数（仅限 `stdio` 服务器）。

- **`--restart-delay <ms>`**
  - 更新重启尝试之间的延迟（以毫秒为单位）（仅限 `stdio` 服务器）。

## 示例

### 标准语法

```bash
# 更新服务器的标签
npx -y @1mcp/agent mcp update my-server --tags="new-tag,another-tag"

# 更新环境变量
npx -y @1mcp/agent mcp update my-stdio-server --env="NODE_ENV=production"

# 更改 HTTP 服务器的 URL
npx -y @1mcp/agent mcp update my-http-server --url="https://new.api.com/mcp"
```

### 快速“ -- ”模式语法

```bash
# 使用“ -- ”模式更新服务器命令
npx -y @1mcp/agent mcp update my-server -- npx -y updated-package

# 在保留环境变量和标签的同时更新命令
npx -y @1mcp/agent mcp update airtable -- npx -y @airtable/mcp-server-v2

# 使用其他选项进行更新
npx -y @1mcp/agent mcp update my-server --timeout=10000 -- node updated-server.js

# 更新重启配置
npx -y @1mcp/agent mcp update my-server --restart-on-exit --max-restarts=3 --restart-delay=1500

# 更新工作目录和 HTTP 标头
npx -y @1mcp/agent mcp update stdio-server --cwd=/new/path
npx -y @1mcp/agent mcp update http-server --headers="Authorization=Bearer newtoken" --timeout=5000
```

## 另请参阅

- **[服务器管理指南](../../guide/essentials/server-management)**
