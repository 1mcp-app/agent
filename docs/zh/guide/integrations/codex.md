# Codex 集成

本指南介绍如何将 1MCP 与 Codex 集成，实现高级 MCP 服务器管理、项目特定配置和可流式传输的 HTTP 传输能力。

## 概述

### Codex 版本兼容性

#### Codex < 0.44.0（有限支持）

[0.44.0](https://github.com/openai/codex/releases/tag/rust-v0.44.0) 之前的 Codex 版本对 MCP 服务器的支持有限：

- **无 HTTP 传输**：无法直接连接到 HTTP/SSE 端点
- **仅支持 STDIO**：仅支持通过 STDIO 传输的 MCP 服务器
- **无项目特定设置**：仅全局配置，没有项目特定的服务器管理

#### Codex ≥ 0.44.0（HTTP 传输支持）

Codex 0.44.0 及更高版本原生支持基于 HTTP 的 MCP 服务器：

- **HTTP 传输**：可直接连接到 HTTP/SSE 端点
- **全局配置**：HTTP 服务器在 `config.toml` 中全局配置
- **无项目特定设置**：仍然缺乏项目特定的服务器管理

**注意**：Codex 项目特定配置尚未实现（[参见 codex pr#4007](https://github.com/openai/codex/pull/4007)）。

### 为什么即使在 Codex ≥ 0.44.0 时仍推荐使用 1MCP 代理？

虽然 Codex ≥ 0.44.0 可以直接连接 HTTP MCP 服务器，但**仍然推荐使用 1MCP 代理**，原因如下：

#### 1. **项目特定服务器管理**

```toml
# 直接 Codex HTTP（全局 - 影响所有项目）
[mcp_servers.1mcp]
url="http://localhost:3050/mcp"

# vs 1MCP 代理（通过 .1mcprc 实现项目特定）
# 项目 A：{"preset": "web-dev"}      # 仅 Web 服务器
# 项目 B：{"preset": "data-science"} # 仅数据服务器
# 项目 C：{"preset": "backend"}     # 仅后端服务器
```

#### 2. **高级标签过滤**

```bash
# 1MCP 代理：通过预设选择性暴露服务器
npx -y @1mcp/agent preset create web-dev --filter "frontend OR design"
npx -y @1mcp/agent preset create data-science --filter "data-science OR ai"
npx -y @1mcp/agent preset create backend --filter "backend OR api"
```

#### 3. **集中式服务器管理**

- **单一源**：在一个地方管理所有 MCP 服务器
- **热重载**：无需重启 Codex 即可更新配置
- **团队共享**：在团队成员之间共享预设

### 1MCP 桥接解决方案

1MCP 通过以下方式提供全面的 MCP 服务器管理：

- **HTTP ↔ STDIO 代理**：在 HTTP 传输和 STDIO 传输之间转换
- **项目级配置**：通过 `.1mcprc` 文件和预设实现项目级 MCP 服务器设置
- **高级过滤**：基于标签的服务器选择和过滤
- **集中式管理**：统一的服务器生命周期和能力聚合

`.1mcprc` 与预设 + 代理 + 服务组合为不同的项目提供不同的 MCP 服务器，即使支持 HTTP 传输的更新版 Codex 也能实现此功能。

## 术语

为避免混淆，本指南使用以下术语：

| 术语            | 定义                                                        | 示例命令                                      |
| --------------- | ----------------------------------------------------------- | --------------------------------------------- |
| **1MCP Agent**  | 包含所有 1MCP 功能的整个 npm 包 `@1mcp/agent`               | `npx -y @1mcp/agent --version`                |
| **1MCP Server** | 使用 `serve` 命令启动的聚合 MCP 服务器的 HTTP 服务器进程    | `npx -y @1mcp/agent serve`                    |
| **1MCP Proxy**  | 使用 `proxy` 命令启动的用于 Codex 集成的 STDIO 到 HTTP 桥接 | `npx -y @1mcp/agent proxy`                    |
| **MCP Server**  | 个别的模型上下文协议服务器（filesystem、github 等）         | `npx @modelcontextprotocol/server-filesystem` |
| **Preset**      | 通过标签过滤定义要暴露的 MCP 服务器的命名配置               | `npx -y @1mcp/agent preset create my-preset`  |

**架构流程**：

```
Codex (STDIO) ← 1MCP Proxy (STDIO↔HTTP) ← 1MCP Server (HTTP) ← MCP Servers
```

## 备选方案：直接 HTTP 传输（Codex ≥ 0.44.0）

对于更简单的设置，将 Codex 直接连接到 1MCP Server 通过 HTTP：

```bash
1mcp serve  # 启动 1MCP 服务器
```

编辑 `config.toml`：

```toml
[mcp_servers.1mcp]
url = "http://localhost:3051/mcp"
```

**限制**：所有服务器全局可用（无项目特定过滤，无基于标签的选择）。**使用 1MCP 代理**进行项目特定服务器管理和团队协作。

## 前置条件

### 系统要求

- **Node.js**：MCP 服务器和 1MCP agent 需要 18+ 版本

  ```bash
  node --version  # 应该是 v18.0.0 或更高
  ```

- **1MCP Agent**：推荐最新版本

  ```bash
  # 全局安装以便使用（推荐）
  npm install -g @1mcp/agent

  # 验证安装
  1mcp --version

  # 备选方案：使用 npx（无需安装）
  npx -y @1mcp/agent --version
  ```

> **提示**：使用 `npm install -g @1mcp/agent` 全局安装允许你在本指南中使用更短的 `1mcp` 命令而不是 `npx -y @1mcp/agent`。

### 安装

如果你还没有安装 Codex，请访问 [官方 Codex 仓库](https://github.com/openai/codex) 获取安装说明。

### 配置文件位置

Codex 将其配置存储在：

- **Linux/macOS**：`~/.codex/config.toml`
- **Windows**：`%APPDATA%\\codex\\config.toml`

如果目录不存在则创建：

```bash
mkdir -p ~/.codex  # Linux/macOS
```

### 已知问题

> **⚠️ 重要**：Codex 0.44.0 的 HTTP 传输支持是实验性的。如果直接 HTTP 连接遇到问题，请改用 1MCP 代理方法。详情请参见[故障排除](#故障排除)。

### 验证清单

在继续之前，请验证：

- [ ] 已安装 Codex 版本 ≥ 0.44.0（或代理方法的任何版本）
- [ ] 已安装 Node.js 版本 ≥ 18
- [ ] 可以成功运行 `1mcp --version`（或 `npx -y @1mcp/agent --version`）
- [ ] 配置目录存在于 `~/.codex/`
- [ ] 有一个用于测试的工作目录（例如 `~/test-codex-integration/`）

### 项目目录

你需要一个工作空间目录来使用集成。这里是你将创建 `.1mcprc` 配置文件的地方。

## 快速开始

### 1. 安装并启动 1MCP 服务器

```bash
# 添加一些带有标签的 MCP 服务器用于预设过滤
1mcp mcp add filesystem --tags=files,local -- npx -y @modelcontextprotocol/server-filesystem /tmp
1mcp mcp add github --tags=git,remote,collaboration -- npx -y @modelcontextprotocol/server-github

# 在后台启动 1MCP 服务器
1mcp serve
```

> **注意**：如果你没有全局安装，请使用 `npx -y @1mcp/agent` 代替 `1mcp`

### 2. 创建项目配置

在你的 Codex 项目目录中，创建一个 `.1mcprc` 文件：

```json
{
  "preset": "codex-development"
}
```

### 3. 创建预设

```bash
# 使用标签为 Codex 开发创建预设
1mcp preset create codex-development --filter "files OR git OR collaboration"
```

**重要**：预设基于标签过滤服务器。始终标记你的服务器，否则它们不会被包含在预设中。

### 4. 配置 Codex

在你的 Codex 配置中添加 1MCP 代理作为 MCP 服务器：

编辑你的 Codex `config.toml` 文件（位置见[前置条件](#前置条件)）：

```toml
[mcp_servers.1mcp]
command = "npx"
args = ["-y", "@1mcp/agent@latest", "proxy"]
```

> **重要**：
>
> - 1MCP 代理的工作目录应该是包含 `.1mcprc` 的项目目录
> - 从你的项目根目录启动 Codex 以确保它加载正确的配置

### 5. 在你的项目目录中启动 Codex

```bash
cd /path/to/my-project
codex
```

### 6. 在 Codex 中测试

```bash
# 在 Codex 中测试
/mcp
```

## 架构

### 1MCP 代理集成（推荐）

```
┌─────────────────┐     STDIO      ┌──────────────────┐      HTTP      ┌─────────────────┐
│      Codex      │ ◄────────────► │    1MCP Proxy    │ ◄────────────► │   1MCP Server   │
│   (any version) │                │   (reads .1mcprc)│                │   (no auth)     │
└─────────────────┘                └──────────────────┘                └─────────────────┘
        │                                   │                                   │
        │                                   │                                   ▼
        │                                   │                          ┌─────────────────┐
        │                                   │                          │   MCP Servers   │
        ▼                                   ▼                          │ (filesystem,    │
┌─────────────────┐                ┌──────────────────┐                │  github, db,    │
│ config.toml     │                │ .1mcprc + Preset │                │  etc.)          │
│(MCP server list)│                │ (project config) │                └─────────────────┘
└─────────────────┘                └──────────────────┘                         │
                                                                          Tag-based
                                                                         filtering
```

**数据流**：

1. **Codex 配置**：在 `config.toml` 中添加 1MCP 代理作为 MCP 服务器
2. **项目检测**：代理从当前项目目录读取 `.1mcprc` 文件
3. **预设加载**：代理加载指定的预设配置
4. **服务器连接**：代理通过 HTTP 连接到 1MCP 服务器
5. **标签过滤**：1MCP 服务器基于预设标签过滤 MCP 服务器
6. **能力聚合**：过滤后的服务器暴露给 Codex
7. **双向通信**：MCP 协议通过代理桥接流动

### 直接 HTTP 集成（Codex ≥ 0.44.0）

```
┌─────────────────┐     HTTP/SSE   ┌──────────────────┐
│      Codex      │ ◄────────────► │   1MCP Server    │
│   (≥ 0.44.0)    │                │   (global config)│
└─────────────────┘                └──────────────────┘
        │                                   │
        ▼                                   ▼
┌─────────────────┐                ┌─────────────────┐
│ config.toml     │                │   MCP Servers   │
│ (HTTP URL only) │                │ (all servers,   │
└─────────────────┘                │  no filtering)  │
                                   └─────────────────┘
```

**限制**：无项目特定配置，无标签过滤，仅全局服务器

### 关键差异

| 方面             | 1MCP 代理                 | 直接 HTTP                 |
| ---------------- | ------------------------- | ------------------------- |
| **项目特定配置** | ✅ `.1mcprc` 文件         | ❌ 仅全局                 |
| **服务器过滤**   | ✅ 基于标签的预设         | ❌ 所有服务器             |
| **项目隔离**     | ✅ 不同项目使用不同服务器 | ❌ 所有地方使用相同服务器 |
| **团队共享**     | ✅ 可共享的预设           | ❌ 手动同步               |
| **设置复杂性**   | ⚠️ 中等                   | ✅ 简单                   |

## 工作目录要求

**关键**：必须从包含 `.1mcprc` 文件的项目目录执行 1MCP 代理：

```bash
# ✅ 正确 - 从项目根目录
cd /path/to/my-project
codex

# ❌ 错误 - 从错误的目录
cd /home/user
codex  # 不会找到 .1mcprc
```

如果使用 Codex 的配置文件方法，请确保在 MCP 服务器配置或工作空间设置中正确设置工作目录。

## 配置选项

### 基本项目配置

在你的项目根目录创建 `.1mcprc`：

```json
{
  "preset": "development-setup"
}
```

### 带过滤的高级配置

```json
{
  "filter": "web OR api OR filesystem"
}
```

### 多环境设置

为不同环境创建不同的预设：

**开发（`.1mcprc.dev`）**：

```json
{
  "preset": "dev-environment",
  "filter": "filesystem,web,database,test"
}
```

**生产（`.1mcprc.prod`）**：

```json
{
  "preset": "production",
  "filter": "web,api,database,monitoring"
}
```

在环境之间切换：

```bash
# 使用开发预设
ln -sf .1mcprc.dev .1mcprc

# 使用生产预设
ln -sf .1mcprc.prod .1mcprc
```

## 预设管理

### 创建预设

```bash
# Web 开发预设
npx -y @1mcp/agent preset create web-dev --filter "filesystem,web,api"

# 数据科学预设
npx -y @1mcp/agent preset create data-science --filter "filesystem,database,python"

# 全栈预设
npx -y @1mcp/agent preset create full-stack --filter "web,api,database,filesystem"
```

### 列出预设

```bash
npx -y @1mcp/agent preset list
```

### 在项目中使用预设

你的 `.1mcprc` 文件仅引用预设：

```json
{
  "preset": "web-dev"
}
```

这能够实现：

- **团队一致性**：在团队成员之间共享预设
- **轻松切换**：通过更新预设名称更改环境
- **集中式管理**：在一个地方更新服务器

## 示例：项目特定预设

```bash
# Web 开发
1mcp mcp add filesystem --tags=files,web -- npx -y @modelcontextprotocol/server-filesystem ./src
1mcp preset create web-dev --filter "files OR git OR web"
echo '{"preset": "web-dev"}' > .1mcprc

# 数据科学
1mcp mcp add python --tags=python,data -- npx -y @modelcontextprotocol/server-python
1mcp preset create data-science --filter "python OR database OR data"
echo '{"preset": "data-science"}' > .1mcprc

# 团队协作 - 不同角色使用不同预设
1mcp preset create frontend --filter "frontend OR ui OR design"
1mcp preset create backend --filter "backend OR database OR api"
```

## 标签和预设：基本概念

### 标签为何重要

标签是 1MCP 过滤系统的基础。它们能够实现：

1. **项目特定服务器**：不同项目访问不同的 MCP 服务器
2. **团队协作**：共享定义团队所需服务器的预设
3. **灵活分组**：按功能、环境或团队对服务器进行分组
4. **安全性**：使用基于标签的过滤限制对敏感服务器的访问

**关键原则**：预设基于**标签**过滤 MCP 服务器，而不是服务器名称。

### 标签策略

#### 推荐的标签类别

| 类别     | 示例                                     | 目的         |
| -------- | ---------------------------------------- | ------------ |
| **功能** | `files`、`database`、`api`、`git`        | 服务器的作用 |
| **环境** | `development`、`production`、`staging`   | 使用地点     |
| **范围** | `local`、`remote`、`frontend`、`backend` | 访问范围     |
| **目的** | `tools`、`monitoring`、`collaboration`   | 为何需要     |

### 添加标签

在 `--` 分隔符前使用 `--tags` 参数：

```bash
1mcp mcp add filesystem --tags=files,local -- npx -y @modelcontextprotocol/server-filesystem ./src
```

### 创建预设

```bash
1mcp preset create dev-tools --filter "development OR tools"
1mcp preset create backend --filter "backend AND development"
1mcp preset create fullstack --filter "(frontend OR backend) AND development"
```

### 常见错误

❌ 缺少标签：`1mcp mcp add server -- ...`
✅ 始终标记：`1mcp mcp add server --tags=dev,tools -- ...`

❌ 不一致：`dev`、`development`、`dev-mode`
✅ 一致：始终使用 `development`

### 调试命令

```bash
1mcp mcp list                    # 查看所有服务器和标签
1mcp preset show my-preset       # 查看预设包含哪些服务器
1mcp proxy --filter "..."        # 测试过滤表达式
```

### 复杂过滤表达式

```json
{
  "filter": "(filesystem AND development) OR (github AND collaboration)"
}
```

### 排除逻辑

```json
{
  "filter": "web AND NOT test AND NOT debug"
}
```

## 故障排除

**服务器未找到**：`1mcp mcp status`、`1mcp serve`（不带 `--enable-auth`）、用 `curl http://localhost:3051/mcp` 测试

**配置未加载**：检查 `.1mcprc` 是否存在（`ls -la .1mcprc`）、验证 JSON（`cat .1mcprc | jq`）、用 `1mcp proxy` 测试

**预设未找到**：`1mcp preset list`、创建它或在 `.1mcprc` 中使用直接过滤

**服务器未显示**：`1mcp mcp list`、验证标签匹配预设过滤、检查 `1mcp preset show <name>`

**Codex 连接失败**：

1. 验证代理工作：`1mcp proxy`
2. 检查 `config.toml` 语法
3. 确认服务器运行：`curl http://localhost:3051/health`
4. 重启 Codex

**错误的工作目录**：从包含 `.1mcprc` 的项目根目录启动 Codex

**标签过滤问题**：验证服务器有标签（`1mcp mcp list`）、检查预设过滤（`1mcp preset show <name>`）

**预设更改被忽略**：重启 Codex 和 1MCP 服务器（`pkill -f "1mcp.*serve" && 1mcp serve`）

**调试**：`1mcp proxy --log-file=proxy.log`、`1mcp mcp status`

**性能**：使用 `1mcp proxy --timeout=30000` 增加超时

## 最佳实践

- **身份验证**：代理不支持身份验证 - 使用不带 `--enable-auth` 的 `1mcp serve`
- **项目结构**：将 `.1mcprc` 保留在项目根目录中，对其进行版本控制（除非包含机密）
- **标签一致性**：在团队中使用标准标签名称
- **性能**：仅加载需要的服务器，对过滤使用一致的标签

## 后续步骤

**创建更多预设**：`1mcp preset create <name> --filter "<tags>"`

**团队入门**：

- 在项目 README 中记录设置
- 共享 `.1mcprc` 和预设配置（如果不包含机密则可版本控制）
- 标准化标签约定

**优化**：

- 监控健康：`1mcp mcp status`
- 固定版本：`1mcp mcp add server --tags=stable -- npx -y @org/server@1.0.0`

**相关指南**：

- [Claude Desktop 集成](./claude-desktop.md)
- [配置指南](../essentials/configuration.md)
- [安全最佳实践](../../reference/security.md)

## 另请参见

- **[代理命令](../../commands/proxy.md)** - 详细代理命令文档
- **[快速开始](../quick-start.md)** - 基本 1MCP 设置
- **[配置指南](../essentials/configuration.md)** - 高级配置选项
- **[预设命令](../../commands/preset/)** - 预设管理命令
- **[MCP 命令](../../commands/mcp/)** - MCP 服务器管理
