# 预设命令

预设命令提供了一个强大的系统来动态管理服务器配置。创建命名的预设来定义服务器选择标准，然后使用它们来切换服务器上下文，而无需重新配置您的 MCP 客户端。

## 概述

预设命令允许您：

- **为不同的服务器上下文创建命名配置**（开发、生产、测试）
- **使用 URL 查询参数动态切换服务器上下文**
- **通过预设 URL 共享团队配置**
- **通过基于标签的过滤保持灵活的服务器选择**

## 快速参考

```bash
# 智能交互模式（自动检测现有预设）
1mcp preset                              # 创建新的或编辑现有的
1mcp preset edit development              # 编辑现有预设

# 命令行预设创建
1mcp preset create dev --filter "web,api,database"
1mcp preset create prod --filter "web AND database AND monitoring"

# 预设管理
1mcp preset list                        # 列出所有预设
1mcp preset show development            # 显示详细预设信息
1mcp preset url development             # 生成客户端 URL
1mcp preset test development            # 测试服务器匹配
1mcp preset delete old-preset           # 删除预设
```

## 核心概念

### 预设

预设是一个保存的配置，定义了在特定上下文中应该有哪些服务器可用。每个预设包含：

- **名称**：预设的唯一标识符
- **策略**：标签应该如何匹配（OR、AND 或 Advanced）
- **标签查询**：服务器选择的过滤条件
- **描述**：可选的人类可读描述

### 基于标签的过滤

服务器可以在您的配置中标记，预设使用这些标签来确定要包含哪些服务器：

```json
{
  "myserver": {
    "command": "node",
    "args": ["server.js"],
    "tags": ["web", "api", "development"]
  }
}
```

### 动态切换

创建后，预设可以通过 URL 查询参数使用：

- `http://localhost:3050/?preset=development` - 使用开发服务器
- `http://localhost:3050/?preset=production` - 使用生产服务器
- `http://localhost:3050/` - 使用所有服务器（无预设）

## 命令

### [智能交互模式](./)（无子命令）

智能交互模式，自动检测现有预设并提供创建新或编辑现有预设的选项。

```bash
1mcp preset                              # 自动检测并提供选项
```

### [edit](./edit)

以可视化服务器选择交互式编辑现有预设。

```bash
1mcp preset edit development              # 编辑现有预设
```

### [create](./create)

使用过滤表达式进行命令行预设创建。

```bash
1mcp preset create dev --filter "web,api,database"
1mcp preset create prod --filter "web AND database AND monitoring"
```

### [list](./list)

以格式化表格显示所有可用的预设。

```bash
1mcp preset list
```

### [show](./show)

显示特定预设的详细信息。

```bash
1mcp preset show development
```

### [url](./url)

为预设生成客户端 URL。

```bash
1mcp preset url development
```

### [test](./test)

针对您当前的服务器配置测试预设。

```bash
1mcp preset test development
```

### [delete](./delete)

从您的配置中删除预设。

```bash
1mcp preset delete old-staging
```

## 使用工作流程

### 交互式工作流程（基于 TUI）

适合偏好可视化选择和探索的用户：

1. **智能交互模式**：`1mcp preset` - 自动检测现有预设
2. **直接编辑**：`1mcp preset edit development` - 编辑现有预设
3. **可视化服务器选择**，使用三态复选框
4. **选择策略**（OR/AND/Advanced）并实时预览
5. **保存并获取 URL** 用于客户端配置

### 命令行工作流程

适合自动化和快速预设创建：

1. **创建预设**：`1mcp preset create dev --filter "web,api"`
2. **生成 URL**：`1mcp preset url dev`
3. **配置客户端** 使用生成的 URL
4. **测试预设**：`1mcp preset test dev`
5. **列出预设**：`1mcp preset list`

### 团队共享工作流程

在团队成员之间共享预设配置：

1. **创建团队预设**：

   ```bash
   1mcp preset create team-dev --filter "web,api,database"
   1mcp preset create team-prod --filter "web,database,monitoring"
   ```

2. **与团队共享 URL**：

   ```bash
   1mcp preset url team-dev
   # 共享：http://localhost:3050/?preset=team-dev
   ```

3. **团队成员使用共享 URL 配置客户端**
4. **通过更改 URL 参数切换上下文**

## 高级用法

### 复杂过滤表达式

创建复杂的服务器选择规则：

```bash
# 多环境排除
1mcp preset create secure-dev --filter "(web OR api) AND development AND NOT experimental"

# 跨职能团队预设
1mcp preset create fullstack --filter "(frontend AND web) OR (backend AND api) OR (database AND persistence)"

# 环境特定监控
1mcp preset create prod-monitored --filter "production AND (web OR api) AND monitoring"
```

### URL 配置示例

在不同的 MCP 客户端配置中使用预设：

**Claude Desktop (`claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "1mcp-development": {
      "command": "npx",
      "args": ["-y", "@1mcp/agent", "serve"],
      "env": {
        "ONE_MCP_PRESET_URL": "http://localhost:3050/?preset=development"
      }
    }
  }
}
```

**Cursor/VS Code:**

```json
{
  "mcp.servers": {
    "1mcp-production": {
      "url": "http://localhost:3050/?preset=production"
    }
  }
}
```

### 预设管理最佳实践

1. **使用描述性名称**：`web-dev`、`prod-api`、`staging-full`
2. **为复杂预设添加描述**
3. **共享前测试预设**：`1mcp preset test <name>`
4. **定期清理**：删除未使用的预设
5. **在共享文档中记录团队预设**

## 集成

### 服务器标记

为您的服务器添加标记以实现有效的预设过滤：

```json
{
  "webserver": {
    "command": "mcp-server-web",
    "tags": ["web", "frontend", "development"]
  },
  "database": {
    "command": "mcp-server-db",
    "tags": ["database", "persistence", "production"]
  },
  "monitoring": {
    "command": "mcp-server-monitor",
    "tags": ["monitoring", "observability", "production"]
  }
}
```

### HTTP 中间件

预设通过内置的 HTTP 中间件工作：

1. 从请求 URL 中提取 `?preset=name`
2. 使用 PresetManager 将预设解析为标签查询
3. 基于标签匹配过滤可用服务器
4. 如果未找到预设，则回退到所有服务器

### 客户端配置

使用预设 URL 一次配置您的 MCP 客户端，然后通过更改预设参数切换上下文，无需重新启动客户端。

## 故障排除

### 常见问题

**预设未找到**：使用 `1mcp preset list` 检查预设名称拼写

**没有服务器匹配**：使用 `1mcp preset test <name>` 查看匹配结果

**无效的过滤表达式**：检查过滤语法 - 对复杂表达式使用引号

**URL 不工作**：验证服务器正在运行且预设存在

### 调试命令

```bash
# 列出所有预设
1mcp preset list

# 显示详细预设信息
1mcp preset show <name>

# 测试预设匹配
1mcp preset test <name>

# 检查服务器配置
1mcp mcp status
```
