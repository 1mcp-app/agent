---
title: CLI Setup 命令
description: 为 Codex 或 Claude 安装 1MCP CLI 模式的引导文档和 hooks。
---

# CLI Setup 命令

为 Codex 或 Claude 安装 1MCP CLI 的引导文档和钩子配置。

## 概要

```bash
npx -y @1mcp/agent cli-setup (--codex | --claude) [选项]
```

## 描述

`cli-setup` 会安装轻量级引导文件，让 Codex 或 Claude 会话按 1MCP CLI 工作流启动。它会写入：

- 受管理的 `1MCP.md` 引导文档
- 受管理的 `SessionStart` 和 `SubagentStart` 引导命令钩子
- 从 `AGENTS.md` 或 `CLAUDE.md` 指向启动文档的引用

`cli-setup` 不会替代 [`instructions`](./instructions.md)。它的作用是确保会话准备好按正确顺序使用 `instructions`、`inspect` 和 `run`。

可以把 `cli-setup` 理解为把现有 agent 工作流迁移到 1MCP CLI 模式的桥。它负责教客户端怎么开始，但真正的实时发现和执行仍然通过 `instructions`、`inspect`、`run` 完成。

## 必选客户端

必须且只能选择一个目标：

- **`--codex`** - 仅为 Codex 安装
- **`--claude`** - 仅为 Claude 安装

如果两个都不传或同时传入，命令会报错。

## 选项

- **`--scope <global|repo|all>`** - 安装范围，默认 `global`
- **`--repo-root <path>`** - repo 级安装时使用的仓库根目录

## 范围行为

- **`global`** - 写入用户 home 目录下的 Codex 或 Claude 配置位置
- **`repo`** - 在指定仓库内写入 repo-local 配置
- **`all`** - 同时写入全局与 repo 级配置

## 写入的文件

### Codex

- 全局受管理文档：`~/.codex/1MCP.md`
- 全局 hooks：`~/.codex/hooks.json`
- 全局启动引用：`~/.codex/AGENTS.md`
- Repo 受管理文档：`<repo>/.codex/1MCP.md`
- Repo hooks：`<repo>/.codex/hooks.json`
- Repo 启动引用：`<repo>/AGENTS.md`

### Claude

- 全局受管理文档：`~/.claude/1MCP.md`
- 全局 hooks：`~/.claude/settings.json`
- 全局启动引用：`~/.claude/CLAUDE.md`
- Repo 受管理文档：`<repo>/.claude/1MCP.md`
- Repo hooks：`<repo>/.claude/settings.json`
- Repo 启动引用：`<repo>/CLAUDE.md`

## 示例

### 安装全局 Codex 配置

```bash
npx -y @1mcp/agent cli-setup --codex
```

### 安装 Repo 级 Claude 配置

```bash
npx -y @1mcp/agent cli-setup --claude --scope repo --repo-root .
```

### 同时安装全局和 Repo 级 Codex 配置

```bash
npx -y @1mcp/agent cli-setup --codex --scope all
```

## Codex 后续配置

当使用 `--codex` 时，命令还会输出一段必须加入 `config.toml` 的配置，用于开启 Codex hooks，以及带网络访问的 `workspace-write` 沙箱。

## 最终工作流

受管理的启动文档会告诉客户端：

1. 如果当前会话尚未通过 hooks 注入最新内容，就先执行 `1mcp instructions`
2. 不知道提供方或工具时，可先执行 `1mcp inspect --search <query>`（也可指定服务器）；已知目标时直接检查
3. 在选择工具前执行 `1mcp inspect <server>` 并阅读适用的服务器指令
4. 在调用工具前先执行 `1mcp inspect <server>/<tool>`
5. 只有在确认 schema 之后才执行 `1mcp run <server>/<tool> --args '<json>'`

搜索默认使用不区分大小写的字面子串匹配。使用带引号的 `--search 'filesystem/*read?' --glob` 可按 `*`/`?` 对整个引用匹配。`--include-descriptions` 将有效描述纳入匹配；`--show-descriptions` 独立控制描述显示。

重新运行相同的 `cli-setup` 命令即可更新任意范围的受管理指引。重复执行保持文件字节稳定，并保留无关的启动文档内容和 hooks，包括与受管理命令混在同一条目中的自定义命令。完全匹配的旧 `1mcp instructions` 钩子会替换为两个事件各自的无条件 `1mcp bootstrap --client <client> --event <event>` 钩子；带额外参数的自定义命令仍由用户管理。全局和仓库钩子可能重复交付指引，重复交付不会抑制另一个目标的 worker 指令。

## Worker 引导与项目分配

`bootstrap` 从 stdin 读取客户端钩子 JSON，为指定事件输出 `hookSpecificOutput.additionalContext`。[Codex](https://developers.openai.com/codex/hooks) 和 [Claude](https://code.claude.com/docs/en/hooks) 均支持该格式。stdin 上限为 64 KiB，等待期限为一秒；运行时指令获取期限为五秒，输出上限为 32 KiB，最终上下文预算为 9,000 字符。超过限制时交付通用指引并报告覆盖缺口，不声称已经交付完整项目指令。

上下文预算包含转义后的项目分配和恢复指引。无法完整容纳的分配会整体省略；引导会报告交付上下文中的项目选择未解决，并要求 worker 从派发指令中恢复原始目标参数。

`SessionStart` 可获取普通会话的运行时指令。`SubagentStart` 没有明确分配时，只交付 inspect-before-run 指引并报告项目选择未解决；不会用钩子 cwd 或父会话身份选择父 checkout。客户端官方钩子 schema 没有 worker 项目分配字段。

Bootstrap 从显式 CLI 参数解析选项，不使用继承的 `ONE_MCP_*` 选项。获取指令的子进程去除继承的 `ONE_MCP_PROJECT` 和 `ONE_MCP_PROJECT_SET`，保留其它环境传递。父任务的环境目标参数不会给未分配的 worker 自动指定目标。

在派发任务的上下文中，为每个 worker 写明绝对 checkout 路径或项目集合定义文件的绝对路径。Worker 在获取项目指令或调用工具之前执行其中一种命令：

```bash
1mcp bootstrap --client codex --event SubagentStart --project /absolute/frontend-checkout
1mcp bootstrap --client claude --event SubagentStart --project-set /absolute/feature-projects.json
1mcp bootstrap --client codex --event SubagentStart --project-set /absolute/feature-projects.json --project backend --project frontend
```

不使用项目集合时，只分配一个绝对 checkout 路径。使用 `--project-set` 时，可重复传入 `--project` 选择有序成员标签，并覆盖定义中可选的 `selection`。在后续 `instructions`、`inspect` 和 `run` 调用中保留目标参数。多个项目的分配要求对 checkout 专属工具明确选择 checkout；单项目工具由 agent 协调分别调用。获取指令时参数通过 argv 传递，不经过 shell。定义格式和后端目标契约参见 [项目 Checkout 与集合](../guide/project-checkouts.md)。

## 验证钩子交付

生成钩子配置不证明客户端已经启用或信任它、钩子实际执行、运行时可用或目标 checkout 索引就绪。应检查客户端在两个事件中实际收到 `additionalContext`。禁用或未信任的钩子、因包含注释而保留未修改的配置、运行时失败和未解决的 worker 分配都属于引导覆盖缺口。项目工具调用前先解决缺口；setup 不会自动开启钩子或修改信任设置。

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)** - 面向 agent 的 CLI 工作流概念说明
- **[Instructions 命令](./instructions.md)** - `cli-setup` 最终引导会话进入的命令
- **[Inspect 命令](./inspect.md)** - 发现工具和查看 schema
- **[Run 命令](./run.md)** - 调用选中的工具
- **[Codex 集成指南](../guide/integrations/codex.md)** - Codex 的完整配置流程
