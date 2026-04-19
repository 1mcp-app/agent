# Instructions 命令

显示面向 AI agent 的 CLI 模式工作流和当前服务器清单。

## 概要

```bash
npx -y @1mcp/agent instructions [选项]
```

## 描述

`instructions` 是 CLI 模式 agent 工作流的入口命令。它会输出：

- 固定的 CLI playbook，要求 agent 在 `run` 前先执行 `inspect`
- 服务器摘要区域
- 服务器详情区域
- 每个服务器提供的指令块（如果有）

当 agent 或终端会话需要从运行中的 1MCP 实例获取当前指导信息时，应先执行这个命令。

在实际工作流里，`instructions` 的作用就是用一个更紧凑的入口替代“把完整 MCP 工具面直接挂进 agent”。它先给 agent 一个 playbook 和当前清单，再让 agent 通过 `inspect` 逐步缩小范围。

## 输出结构

输出面向 agent 读取，包含：

- `=== PLAYBOOK ===` - 必须遵循的 CLI 工作流
- `=== SERVER SUMMARY ===` - 每个服务器的简要记录
- `=== SERVER DETAILS ===` - 包含指令或可用性备注的详细记录

每个服务器条目通常会包含：

- 服务器名
- 服务器类型
- 连接状态
- 是否可用
- 工具数量
- 是否提供指令

## 选项

- **`--url, -u <url>`** - 覆盖自动发现到的 1MCP 服务器 URL
- **`--preset, -p <name>`** - 查询运行中服务器时使用预设
- **`--tag-filter, -f <expression>`** - 应用高级标签过滤表达式
- **`--tags <tag>`** - 应用简单的逗号分隔标签

## 示例

### 显示完整 CLI Playbook

```bash
npx -y @1mcp/agent instructions
```

### 只显示过滤后的服务器集合

```bash
npx -y @1mcp/agent instructions --tags backend
```

### 使用已保存的预设

```bash
npx -y @1mcp/agent instructions --preset development
```

## 推荐工作流

读取 `instructions` 后，继续执行：

```bash
npx -y @1mcp/agent inspect <server>
npx -y @1mcp/agent inspect <server>/<tool>
npx -y @1mcp/agent run <server>/<tool> --args '<json>'
```

如果需要身份验证，playbook 会提示用户或 agent 使用以下命令重试：

```bash
1mcp auth login --url <server-url> --token <token>
```

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)** - 为什么推荐这种渐进式工作流
- **[Inspect 命令](./inspect.md)** - 发现工具并查看 schema
- **[Run 命令](./run.md)** - 调用选中的工具
- **[CLI Setup 命令](./cli-setup.md)** - 为 Codex 或 Claude 安装启动钩子和引导文档
- **[Serve 命令](./serve.md)** - 启动提供这些指令输出的 1MCP 服务器
