---
title: 命令参考 - 完整 1MCP CLI 指南
description: 1MCP Agent 的完整命令参考。了解 serve、proxy、instructions、inspect、run、cli-setup 等 CLI 命令及示例。
head:
  - ['meta', { name: 'keywords', content: '1MCP 命令,CLI 参考,命令行界面,语法,示例' }]
  - ['meta', { property: 'og:title', content: '1MCP 命令参考 - 完整指南' }]
  - ['meta', { property: 'og:description', content: '1MCP Agent CLI 的完整命令参考。命令、选项和示例。' }]
---

# 命令参考

本章供你按命令组查询准确的语法、选项和示例。

对于 AI 智能体，推荐使用命令行模式：由 `1mcp serve` 管理 MCP 连接，再通过 `instructions`、`inspect`、`run` 逐步发现并调用工具，避免在智能体的每轮交互中暴露全部工具。

如果你尚未完成首次安装或使用，请先阅读[快速入门](/zh/guide/quick-start)。

客户端启动钩子通过 `bootstrap` 交付运行时指引。仅在缺少指引或需要刷新时单独运行 `instructions`。检出目录选择和调用方凭证见[项目与所有者选项](/zh/guide/project-checkouts#项目与所有者选项)。

示例使用已安装的 `1mcp` 命令。请按[安装指南](/zh/guide/installation)将其加入 `PATH`；该指南也介绍作为替代方式的 `npx`。

## 快速参考

### 主要命令

- **`serve`** - 启动 1MCP 服务器（默认命令）
- **`proxy`** - 启动 STDIO 代理连接到运行中的 1MCP HTTP 服务器
- **`instructions`** - 显示 CLI 工作流和当前服务器清单
- **`inspect`** - 列出已暴露的服务器或查看工具输入结构
- **`run`** - 通过运行中的 1MCP 服务器调用工具
- **`cli-setup`** - 安装 Codex 或 Claude 的引导钩子和启动文档
- **`project`** - 准备后端，释放绑定，排空、检查或恢复检出目录准入
- **`auth`** - 管理受保护服务器的认证配置
- **`target`** - 管理已验证的运行时目标上下文（Runtime Target Context）
- **`admin`** - 管理运行时目标上下文的命令行管理会话
- **`app`** - 管理桌面应用程序 MCP 配置
- **`mcp`** - 管理 MCP 服务器配置
- **`preset`** - 管理用于动态过滤的服务器预设

### 全局选项

所有 1MCP 命令都支持以下全局选项：

- **`--help, -h`** - 显示帮助信息
- **`--version`** - 显示版本信息
- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径
- **`--cli-session-cache-path <path>`** - `run` / `inspect` 使用的 CLI 会话缓存路径模板；支持 `{pid}` 与 `{scope}`

**环境变量**：所有全局选项都可以通过带有 `ONE_MCP_` 前缀的环境变量来设置：

- `ONE_MCP_CONFIG=/path/to/config.json`
- `ONE_MCP_CONFIG_DIR=/path/to/config/dir`
- `ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid}.{scope}`

### 命令特定选项

除了全局选项外，每个命令可能还有特定的选项。使用任何命令的 `--help` 查看所有可用选项：

```bash
1mcp mcp add --help
1mcp preset create --help
1mcp serve --help
1mcp inspect --help
```

## 命令组

### CLI 工作流命令

独立终端会话可按以下命令通过运行中的 `1mcp serve` 实例发现并调用工具。使用钩子的智能体会话应复用 `bootstrap` 提供的指引，仅在缺少指引或需要刷新时运行 `instructions`。使用命名或隐式发现的本地运行时时，受支持的 Codex 会话自动解析所有者和已分配项目。Claude 和不支持自动查找所有者的宿主需在每次调用中添加自己的 `bootstrap` 输出中的 `--project-owner <own-file>`。每个工作智能体都使用自己的启动上下文和凭证。

```bash
1mcp instructions
1mcp inspect context7
1mcp inspect context7/query-docs
1mcp run context7/query-docs --args '{"libraryId":"/mongodb/docs","query":"aggregation pipeline"}'
```

- **[instructions](/zh/commands/instructions)** - 打印命令行操作指引和当前服务器清单
- **[inspect](/zh/commands/inspect)** - 发现工具并查看输入结构
- **[run](/zh/commands/run)** - 执行工具调用
- **[wait](/zh/commands/wait)** - 等待已配置静态服务器连接且可用
- **[project prepare](/zh/commands/project/prepare)** - 检查就绪状态并管理检出目录的准备任务
- **[project 生命周期](/zh/commands/project/)** - 释放调用方绑定、检查阻塞项、排空和恢复检出目录准入
- **[cli-setup](/zh/commands/cli-setup)** - 安装 Codex 或 Claude 的引导文件
- **[auth](/zh/commands/auth)** - 管理受保护服务器的认证配置

智能体或操作者需要访问已运行的 `1mcp serve` 实例时，可使用这组命令。

### 为什么会有这些命令

- 直接 MCP 仍然是后端互操作层
- 命令行模式是推荐的智能体操作方式
- `instructions` 提供紧凑清单，而不是一开始就给出全部工具的详细信息
- `inspect` 把发现范围缩小到单个服务器和单个工具
- `run` 只在确认输入结构后执行

### [应用命令](/zh/commands/app/)

管理桌面应用程序 MCP 配置。将来自各种桌面应用程序的 MCP 服务器整合到 1MCP 中。

```bash
1mcp app consolidate claude-desktop    # 整合 Claude Desktop 服务器
1mcp app restore claude-desktop        # 恢复原始配置
1mcp app list                          # 列出支持的应用程序
```

### [MCP 命令](/zh/commands/mcp/)

在您的 1MCP 实例中管理 MCP 服务器配置。

```bash
1mcp mcp add myserver --type=stdio --command=node --args=server.js
1mcp mcp list                       # 列出已配置的服务器
1mcp mcp status                     # 检查服务器状态
1mcp mcp tools list filesystem --disabled
```

### [Preset 命令](/zh/commands/preset/)

管理用于动态过滤和上下文切换的服务器预设。

```bash
1mcp preset create dev --filter "web,api,database"
1mcp preset list                    # 列出所有预设
1mcp preset show development        # 显示预设详细信息
1mcp preset edit staging           # 编辑预设配置
```

### [Serve 命令](/zh/commands/serve)

使用各种配置选项启动 1MCP 服务器。

```bash
1mcp serve                            # 使用默认设置启动
1mcp serve --port=3052                # 在自定义端口上启动
1mcp serve --transport=stdio          # 使用 stdio 传输
```

### [Proxy 命令](/zh/commands/proxy)

启动 STDIO 代理，将仅支持 STDIO 传输的 MCP 客户端连接到运行中的 1MCP HTTP 服务器。

```bash
1mcp proxy                            # 自动发现并连接
1mcp proxy --url http://localhost:3051/mcp  # 连接到特定 URL
1mcp proxy --filter "web,api"         # 使用标签过滤连接
```

### Runtime Target 和 Admin 会话

需要为远程运行时保存持有者令牌（Bearer token）或管理凭据时，请使用命名目标。

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp auth login --context prod --token "$TOKEN"
1mcp instructions --context prod
1mcp admin login --context prod --username operator
```

- **[Runtime Target Context](/zh/commands/target)** - 添加、验证、导入和选择命名目标
- **[Admin 命令](/zh/commands/admin)** - 初始化、登录、检查和撤销 Admin 会话

### Agent 引导安装

当你希望 Codex 或 Claude 会话自动加载 1MCP 引导文档和钩子时，使用 `cli-setup`：

```bash
1mcp cli-setup --codex
1mcp cli-setup --claude --scope repo --repo-root .
```

## 什么时候离开这个章节

如果你现在需要的是学习路径或安装引导，而不是精确命令行为，请转到：

1. **[安装指南](/zh/guide/installation)** - 安装 1MCP Agent
2. **[快速入门](/zh/guide/quick-start)** - 基本设置和第一个服务器
3. **[Instructions 命令](/zh/commands/instructions)** - 从当前服务器清单开始 CLI 工作流
4. **[Inspect 命令](/zh/commands/inspect)** - 发现工具并查看输入结构
5. **[Run 命令](/zh/commands/run)** - 通过运行中的服务器执行工具调用

## 示例

### 基本用法

```bash
# 启动 1MCP 服务器
1mcp serve

# 打印当前 CLI 工作流和服务器清单
1mcp instructions

# 先查看服务器，再查看工具
1mcp inspect filesystem
1mcp inspect filesystem/read_file

# 调用刚刚检查过的工具
1mcp run filesystem/read_file --args '{"path":"./README.md"}'
```

### 高级用法

```bash
# 使用自定义配置启动
1mcp serve --config=/custom/path/config.json --port=3052

# 安装 Codex 引导文档和 hooks
1mcp cli-setup --codex

# 通过 preset 以 JSON 格式查看工具信息
1mcp inspect filesystem --preset development --format json

# 覆盖会话缓存路径后执行工具
ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid} \
  1mcp run filesystem/read_file --args '{"path":"./README.md"}'
```

## 环境变量

所有命令行选项也可以通过带有 `ONE_MCP_` 前缀的环境变量来设置：

```bash
export ONE_MCP_PORT=3052
export ONE_MCP_HOST=0.0.0.0
export ONE_MCP_CONFIG=/custom/config.json
```

## 配置文件

1MCP Agent 使用 JSON 配置文件来存储服务器定义和设置。有关配置文件格式和选项的详细信息，请参阅[配置指南](/zh/guide/essentials/configuration)。
