# CLI Setup 命令

为 Codex 或 Claude 安装 1MCP CLI 的引导文档和钩子配置。

## 概要

```bash
npx -y @1mcp/agent cli-setup (--codex | --claude) [选项]
```

## 描述

`cli-setup` 会安装轻量级引导文件，让 Codex 或 Claude 会话按 1MCP CLI 工作流启动。它会写入：

- 受管理的 `1MCP.md` 引导文档
- 在会话开始时注入启动文档的钩子配置
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
2. 在选择工具前先执行 `1mcp inspect <server>`
3. 在调用工具前先执行 `1mcp inspect <server>/<tool>`
4. 只有在确认 schema 之后才执行 `1mcp run <server>/<tool> --args '<json>'`

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)** - 面向 agent 的 CLI 工作流概念说明
- **[Instructions 命令](./instructions.md)** - `cli-setup` 最终引导会话进入的命令
- **[Inspect 命令](./inspect.md)** - 发现工具和查看 schema
- **[Run 命令](./run.md)** - 调用选中的工具
- **[Codex 集成指南](../guide/integrations/codex.md)** - Codex 的完整配置流程
