# 按标签筛选服务器

1MCP 代理提供高级基于标签的服务器筛选功能，允许您使用简单的 OR 逻辑和复杂的布尔表达式将请求定向到特定的后端 MCP 服务器。此功能有助于按其功能组织和控制对不同 MCP 服务器的访问。

## 工作原理

连接到 1MCP 代理时，您可以指定标签以筛选可用的后端服务器。代理将仅连接到并路由请求到具有指定标签的服务器。

例如，如果您有两台服务器——一台带有 `filesystem` 标签，另一台带有 `search` 标签——您可以通过在连接中包含适当的标签来控制哪些服务器可用。

## 配置

要启用服务器筛选，您需要在 `mcp.json` 配置文件中为后端服务器分配标签。

```json
{
  "mcpServers": {
    "file_server": {
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "tags": ["filesystem", "read-only"]
    },
    "search_server": {
      "command": ["uvx", "mcp-server-fetch"],
      "tags": ["search", "web"]
    }
  }
}
```

在此示例中：

- `file_server` 标记为 `filesystem` 和 `read-only`。
- `search_server` 标记为 `search` 和 `web`。

## 用法

1MCP 代理支持两种类型的标签筛选：简单 OR 逻辑和高级布尔表达式。

### 简单标签筛选（已弃用）

⚠️ **`--tags` 参数已弃用，将在未来版本中删除。请改用 `--tag-filter`。**

`--tags` 参数提供简单的 OR 逻辑筛选：

```bash
# 仅连接到带有"filesystem"标签的服务器
npx -y @1mcp/agent --transport stdio --tags "filesystem"

# 连接到带有"filesystem"或"web"标签的服务器（OR 逻辑）
npx -y @1mcp/agent --transport stdio --tags "filesystem,web"
```

### 高级标签筛选

新的 `--tag-filter` 参数支持复杂的布尔表达式：

#### 基本操作

```bash
# 单个标签
npx -y @1mcp/agent --transport stdio --tag-filter "filesystem"

# AND 操作（需要两个标签）
npx -y @1mcp/agent --transport stdio --tag-filter "filesystem+web"

# OR 操作（任一标签）
npx -y @1mcp/agent --transport stdio --tag-filter "filesystem,web"

# NOT 操作（排除具有此标签的服务器）
npx -y @1mcp/agent --transport stdio --tag-filter "!test"
```

#### 复杂表达式

```bash
# 带有 (filesystem OR web) AND prod，但不是 test 的服务器
npx -y @1mcp/agent --transport stdio --tag-filter "(filesystem,web)+prod-test"

# 带有 api AND (db OR cache)，但不是 development 的服务器
npx -y @1mcp/agent --transport stdio --tag-filter "api+(db,cache)-development"
```

#### 自然语言语法

标签筛选器还支持自然语言布尔操作符：

```bash
# 使用自然语言 AND
npx -y @1mcp/agent --transport stdio --tag-filter "web and api"

# 使用自然语言 OR
npx -y @1mcp/agent --transport stdio --tag-filter "filesystem or database"

# 使用自然语言 NOT
npx -y @1mcp/agent --transport stdio --tag-filter "api and not test"

# 复杂的自然语言表达式
npx -y @1mcp/agent --transport stdio --tag-filter "(web or api) and production and not development"
```

#### 符号参考

| 操作符 | 符号     | 自然语言 | 示例                           |
| ------ | -------- | -------- | ------------------------------ |
| AND    | `+`      | `and`    | `web+api` 或 `web and api`     |
| OR     | `,`      | `or`     | `web,api` 或 `web or api`      |
| NOT    | `-`, `!` | `not`    | `-test`, `!test` 或 `not test` |
| 分组   | `()`     | `()`     | `(web,api)+prod`               |

### HTTP/SSE 筛选

对于 HTTP 连接，在查询参数中指定标签筛选器：

```bash
# 简单标签筛选
curl "http://localhost:3050/sse?tags=web,api"

# 高级标签筛选（URL 编码）
curl "http://localhost:3050/sse?tag-filter=web%2Bapi"  # web+api
curl "http://localhost:3050/sse?tag-filter=%28web%2Capi%29%2Bprod"  # (web,api)+prod
```

### 从 --tags 迁移到 --tag-filter

对于简单的 OR 逻辑筛选，您可以轻松从 `--tags` 迁移到 `--tag-filter`：

```bash
# 旧版（已弃用）
--tags "web,api,database"

# 新版（推荐）
--tag-filter "web,api,database"
```

### 互斥性

`--tags` 和 `--tag-filter` 参数是互斥的 - 您不能同时使用两者。如果两者都指定，代理将返回错误。
