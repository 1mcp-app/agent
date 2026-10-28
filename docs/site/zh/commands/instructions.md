---
title: Instructions 命令
description: 获取 CLI 模式 agent 工作流和当前服务器发现信息。
---

# Instructions 命令

客户端钩子运行 `bootstrap`，建立所有权并通过 `instructions` 获取指引。智能体仅在缺少当前指引或需要刷新时单独运行 `instructions`；它不会创建所有者凭证。完整流程见[启动工作流](/zh/guide/worktrees-and-cross-project-sessions)。

显示面向 AI agent 的 CLI 模式工作流和当前服务器清单。

工具契约未变化时，可在当前会话内复用已知的工具参数结构，包括跨项目调用。项目专属指令、就绪状态、授权和目标选择仍需保持有效。信息缺失、能力变化、准备完成或发生相关失败时，应重新检查服务器和工具。不得自动重放失败的工具调用。

## 概要

```bash
1mcp instructions [server] [选项]
```

## 描述

不指定服务器时，`instructions` 是 CLI 模式 agent 工作流的入口命令。它会输出：

- 固定的 CLI playbook，要求 agent 在 `run` 前先执行 `inspect`
- 服务器摘要区域
- 服务器详情区域
- 已有的服务器指令块和配置覆盖

当 agent 或终端会话需要从运行中的 1MCP 实例获取当前指导信息时，应先执行这个命令。

在实际工作流里，`instructions` 的作用就是用一个更紧凑的入口替代“把完整 MCP 工具面直接挂进 agent”。它先给 agent 一个 playbook 和当前清单，再让 agent 通过 `inspect` 逐步缩小范围。

不指定服务器时，指令输出会检查当前项目选择、权限和过滤条件，但不会启动模板后端或查询工具清单。尚未查询的工具数量显示为 `unknown`。未启动模板的上游指令可能不可用；此时运行 `1mcp instructions <server>`，仅启动所选后端并在调用工具前阅读其指令。已有指令仍限定于选定会话。这些元数据不能证明后端准备就绪。

不支持指令端点的旧运行时保留原有发现流程，可能在获取指引时初始化后端。

## 单个服务器的指令

```bash
1mcp instructions filesystem
```

指定服务器后，仅输出该服务器的适用指令，包括配置覆盖。该形式复用定向检查流程，可能启动所选模板并查询其工具清单；保留当前项目、所有者、权限和过滤条件，不准备无关后端。服务器没有指令时会明确提示。不接受 `filesystem/read_file` 等工具目标；工具清单和参数结构仍通过 `inspect` 查看。

定向形式复用检查命令的 REST/MCP 兼容路径。不带参数的 `instructions` 保持下述引导输出。

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
- 工具数量；尚未查询时显示 `unknown`
- 是否提供指令

## 选项

- **`--url, -u <url>`** - 覆盖自动发现到的 1MCP 服务器 URL
- **`--context <name>`** - 使用具名 Runtime Target Context 及其保存的 bearer token（如有）
- **`--preset, -p <name>`** - 查询运行中服务器时使用预设
- **`--tag-filter, -f <expression>`** - 应用高级标签过滤表达式
- **`--tags <tag>`** - 应用简单的逗号分隔标签

### 项目选择与所有者

- **`--project <path-or-label>`** — 选择检出目录或项目集合成员。
- **`--project-set <file>`** — 加载保存的项目集合。
- **`--project-owner <file>`** — 需要时使用当前调用方自己的 bootstrap 凭证，覆盖自动所有者查找。

共用规则见[项目与所有者选项](/zh/guide/project-checkouts#项目与所有者选项)。受支持的 Codex 会话自动使用已验证所有者和分配项目。Claude 和不支持自动查找所有者的宿主需提供自己的 bootstrap `--project-owner <own-file>`。相关调用应保持显式目标覆盖一致。

## 示例

### 显示完整 CLI Playbook

```bash
1mcp instructions
```

### 只显示过滤后的服务器集合

```bash
1mcp instructions --tags backend
```

### 使用已保存的预设

```bash
1mcp instructions --preset development
```

### 使用 Runtime Target Context

```bash
1mcp instructions --context prod
```

## 推荐工作流

阅读适用指令后，仅在信息缺失或需要刷新、能力变化、准备完成或发生相关失败时执行检查，再使用已知参数结构调用工具。以下示例假设已配置 `filesystem` 服务器，且其 `read_file` 工具可以读取 `README.md`：

```bash
# 服务器指令缺失或需要刷新时：
1mcp instructions filesystem
# 需要服务器工具清单时：
1mcp inspect filesystem
# 仅在工具参数结构缺失或需要刷新时执行：
1mcp inspect filesystem/read_file
# 使用当前指令和已知参数结构调用：
1mcp run filesystem/read_file --args '{"path":"README.md"}'
```

如果需要身份验证，playbook 会提示用户或 agent 使用以下命令重试：

```bash
1mcp auth login --context <name> --token <token>
```

## 另请参阅

- **[CLI 模式指南](/zh/guide/integrations/cli-mode)** - 为什么推荐这种渐进式工作流
- **[Inspect 命令](/zh/commands/inspect)** - 发现工具并查看 schema
- **[Run 命令](/zh/commands/run)** - 调用选中的工具
- **[CLI Setup 命令](/zh/commands/cli-setup)** - 为 Codex 或 Claude 安装启动钩子和引导文档
- **[Serve 命令](/zh/commands/serve)** - 启动提供这些指令输出的 1MCP 服务器
