# 命令参考

1MCP Agent 提供了一个全面的命令行界面，用于管理 MCP 服务器和桌面应用程序配置。

## 快速参考

### 主要命令

- **`serve`** - 启动 1MCP 服务器 (默认命令)
- **`proxy`** - 启动 STDIO 代理连接到运行中的 1MCP HTTP 服务器
- **`app`** - 管理桌面应用程序 MCP 配置
- **`mcp`** - 管理 MCP 服务器配置
- **`preset`** - 管理用于动态过滤的服务器预设

### 全局选项

所有 1MCP 命令都支持以下全局选项：

- **`--help, -h`** - 显示帮助信息
- **`--version`** - 显示版本信息
- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

**环境变量**：所有全局选项都可以通过带有 `ONE_MCP_` 前缀的环境变量来设置：

- `ONE_MCP_CONFIG=/path/to/config.json`
- `ONE_MCP_CONFIG_DIR=/path/to/config/dir`

### 命令特定选项

除了全局选项外，每个命令可能还有特定的选项。使用任何命令的 `--help` 查看所有可用选项：

```bash
npx -y @1mcp/agent mcp add --help
npx -y @1mcp/agent preset create --help
npx -y @1mcp/agent serve --help
```

## 命令组

### [应用命令](./app/)

管理桌面应用程序 MCP 配置。将来自各种桌面应用程序的 MCP 服务器整合到 1MCP 中。

```bash
npx -y @1mcp/agent app consolidate claude-desktop    # 整合 Claude Desktop 服务器
npx -y @1mcp/agent app restore claude-desktop        # 恢复原始配置
npx -y @1mcp/agent app list                          # 列出支持的应用程序
```

### [MCP 命令](./mcp/)

在您的 1MCP 实例中管理 MCP 服务器配置。

```bash
npx -y @1mcp/agent mcp add myserver --type=stdio --command=node --args=server.js
npx -y @1mcp/agent mcp list                       # 列出已配置的服务器
npx -y @1mcp/agent mcp status                     # 检查服务器状态
```

### [Preset 命令](./preset/)

管理用于动态过滤和上下文切换的服务器预设。

```bash
npx -y @1mcp/agent preset create dev --filter "web,api,database"
npx -y @1mcp/agent preset list                    # 列出所有预设
npx -y @1mcp/agent preset show development        # 显示预设详细信息
npx -y @1mcp/agent preset edit staging           # 编辑预设配置
```

### [Serve 命令](./serve)

使用各种配置选项启动 1MCP 服务器。

```bash
npx -y @1mcp/agent serve                            # 使用默认设置启动
npx -y @1mcp/agent serve --port=3052                # 在自定义端口上启动
npx -y @1mcp/agent serve --transport=stdio          # 使用 stdio 传输
```

### [Proxy 命令](./proxy)

启动 STDIO 代理，将仅支持 STDIO 传输的 MCP 客户端连接到运行中的 1MCP HTTP 服务器。

```bash
npx -y @1mcp/agent proxy                            # 自动发现并连接
npx -y @1mcp/agent proxy --url http://localhost:3051/mcp  # 连接到特定 URL
npx -y @1mcp/agent proxy --filter "web,api"         # 使用标签过滤连接
```

## 入门

如果您是 1MCP Agent 的新手，请从以下内容开始：

1. **[安装指南](../guide/installation)** - 安装 1MCP Agent
2. **[快速入门](../guide/quick-start)** - 基本设置和第一个服务器
3. **[应用命令](./app/)** - 整合现有的 MCP 配置
4. **[MCP 命令](./mcp/)** - 添加和管理 MCP 服务器
5. **[Preset 命令](./preset/)** - 创建和管理服务器预设

## 示例

### 基本用法

```bash
# 启动 1MCP 服务器
npx -y @1mcp/agent serve

# 添加一个新的 MCP 服务器
npx -y @1mcp/agent mcp add filesystem --type=stdio --command=mcp-server-filesystem

# 为仅支持 STDIO 的客户端启动 STDIO 代理
npx -y @1mcp/agent proxy --filter "filesystem,editing"

# 整合 Claude Desktop 配置
npx -y @1mcp/agent app consolidate claude-desktop

# 检查状态
npx -y @1mcp/agent mcp status
```

### 高级用法

```bash
# 使用自定义配置启动
npx -y @1mcp/agent serve --config=/custom/path/config.json --port=3052

# 添加基于 HTTP 的 MCP 服务器
npx -y @1mcp/agent mcp add remote-api --type=http --url=https://api.example.com/mcp

# 批量整合多个应用程序
npx -y @1mcp/agent app consolidate claude-desktop cursor vscode --yes

# 按标签过滤服务器并显示详细信息
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent mcp list --tags=prod,api
```

## 环境变量

所有命令行选项也可以通过带有 `ONE_MCP_` 前缀的环境变量来设置：

```bash
export ONE_MCP_PORT=3052
export ONE_MCP_HOST=0.0.0.0
export ONE_MCP_CONFIG_PATH=/custom/config.json
```

## 配置文件

1MCP Agent 使用 JSON 配置文件来存储服务器定义和设置。有关配置文件格式和选项的详细信息，请参阅[配置指南](../guide/essentials/configuration)。
