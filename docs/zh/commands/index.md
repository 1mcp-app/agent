---
title: 命令参考 - 完整 1MCP CLI 指南
description: 1MCP Agent 的完整命令参考。了解 serve、proxy、instructions、inspect、run、cli-setup 等 CLI 命令及示例。
head:
  - ['meta', { name: 'keywords', content: '1MCP 命令,CLI 参考,命令行界面,语法,示例' }]
  - ['meta', { property: 'og:title', content: '1MCP 命令参考 - 完整指南' }]
  - ['meta', { property: 'og:description', content: '1MCP Agent CLI 的完整命令参考。命令、选项和示例。' }]
---

# 命令参考

1MCP Agent 提供了一个全面的命令行界面，用于管理 MCP 服务器、agent 工作流和桌面应用程序集成。

对于 AI agent，推荐路径是 CLI 模式：把 MCP 保留在 `1mcp serve` 背后，然后通过 `instructions`、`inspect`、`run` 做渐进式披露，而不是在 agent loop 里直接暴露整个工具面。

## 快速参考

### 主要命令

- **`serve`** - 启动 1MCP 服务器 (默认命令)
- **`proxy`** - 启动 STDIO 代理连接到运行中的 1MCP HTTP 服务器
- **`instructions`** - 显示 CLI 工作流和当前服务器清单
- **`inspect`** - 列出已暴露的服务器或查看工具 schema
- **`run`** - 通过运行中的 1MCP 服务器调用工具
- **`cli-setup`** - 安装 Codex 或 Claude 的引导 hooks 和启动文档
- **`auth`** - 管理受保护服务器的认证配置
- **`app`** - 管理桌面应用程序 MCP 配置
- **`mcp`** - 管理 MCP 服务器配置
- **`preset`** - 管理用于动态过滤的服务器预设

### 全局选项

所有 1MCP 命令都支持以下全局选项：

- **`--help, -h`** - 显示帮助信息
- **`--version`** - 显示版本信息
- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径
- **`--cli-session-cache-path <path>`** - `run` / `inspect` 使用的 CLI 会话缓存路径模板

**环境变量**：所有全局选项都可以通过带有 `ONE_MCP_` 前缀的环境变量来设置：

- `ONE_MCP_CONFIG=/path/to/config.json`
- `ONE_MCP_CONFIG_DIR=/path/to/config/dir`
- `ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid}`

### 命令特定选项

除了全局选项外，每个命令可能还有特定的选项。使用任何命令的 `--help` 查看所有可用选项：

```bash
npx -y @1mcp/agent mcp add --help
npx -y @1mcp/agent preset create --help
npx -y @1mcp/agent serve --help
npx -y @1mcp/agent inspect --help
```

## 命令组

### CLI 工作流命令

当你希望 agent 或终端会话通过运行中的 `1mcp serve` 实例发现并调用工具时，请按以下命令顺序使用：

```bash
npx -y @1mcp/agent instructions
npx -y @1mcp/agent inspect context7
npx -y @1mcp/agent inspect context7/get-library-docs
npx -y @1mcp/agent run context7/get-library-docs --args '{"context7CompatibleLibraryID":"/mongodb/docs","topic":"aggregation pipeline"}'
```

- **[instructions](./instructions.md)** - 打印 CLI playbook 和当前服务器清单
- **[inspect](./inspect.md)** - 发现工具并查看 schema
- **[run](./run.md)** - 执行工具调用
- **[cli-setup](./cli-setup.md)** - 安装 Codex 或 Claude 的引导文件
- **[auth](./auth.md)** - 管理受保护服务器的认证配置

### 为什么会有这些命令

- 直接 MCP 仍然是后端互操作层
- CLI 模式是面向 agent 的推荐前端工作流
- `instructions` 提供紧凑清单，而不是一开始就给出庞大的工具面
- `inspect` 把发现范围缩小到单个 server 和单个 tool
- `run` 只在确认 schema 后执行

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

### Agent 引导安装

当你希望 Codex 或 Claude 会话自动带上 1MCP 引导文档和 hooks 时，使用 `cli-setup`：

```bash
npx -y @1mcp/agent cli-setup --codex
npx -y @1mcp/agent cli-setup --claude --scope repo --repo-root .
```

## 入门

如果您是 1MCP Agent 的新手，请从以下内容开始：

1. **[安装指南](../guide/installation)** - 安装 1MCP Agent
2. **[快速入门](../guide/quick-start)** - 基本设置和第一个服务器
3. **[Instructions 命令](./instructions.md)** - 从当前服务器清单开始 CLI 工作流
4. **[Inspect 命令](./inspect.md)** - 发现工具并查看 schema
5. **[Run 命令](./run.md)** - 通过运行中的服务器执行工具调用

## 示例

### 基本用法

```bash
# 启动 1MCP 服务器
npx -y @1mcp/agent serve

# 打印当前 CLI 工作流和服务器清单
npx -y @1mcp/agent instructions

# 先查看服务器，再查看工具
npx -y @1mcp/agent inspect filesystem
npx -y @1mcp/agent inspect filesystem/read_file

# 调用刚刚检查过的工具
npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
```

### 高级用法

```bash
# 使用自定义配置启动
npx -y @1mcp/agent serve --config=/custom/path/config.json --port=3052

# 安装 Codex 引导文档和 hooks
npx -y @1mcp/agent cli-setup --codex

# 通过 preset 以 JSON 格式查看工具信息
npx -y @1mcp/agent inspect filesystem --preset development --format json

# 覆盖会话缓存路径后执行工具
ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid} \
  npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
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
