---
title: CLI 模式 - 面向 AI Agent 的渐进式工具访问
description: 了解为什么 1MCP CLI 模式是 Codex、Claude 等 AI agent 的推荐工作流，以及它如何用更自然的方式把现有 MCP 迁移到命令行。
head:
  - ['meta', { name: 'keywords', content: '1MCP CLI 模式,渐进式披露,agent 工作流,Codex,Claude,token 效率' }]
  - ['meta', { property: 'og:title', content: '1MCP CLI 模式指南' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: '使用 1MCP CLI 模式，让 agent 通过 instructions、inspect、run 按需发现工具，而不是在会话中直接挂载完整 MCP 工具面。',
      },
    ]
---

# CLI 模式

CLI 模式是 1MCP 面向 Codex、Claude 这类 AI agent 的推荐工作流。

它**并不是**替代 MCP 协议本身。1MCP 仍然通过 `1mcp serve` 承载并聚合你的 MCP 服务器。变化的是 agent 在自己的工作循环里看到的接口：不再把大而全的 MCP 工具面直接塞进上下文，而是按需发现、按需检查、按需调用。

对于同一个 agent，CLI 模式不应该和直接 MCP 配置并存。只能二选一。切换到 CLI 模式时，先移除该 agent 现有的 MCP server 配置。

## 为什么会有 CLI 模式

直接把 MCP 挂到 agent 上，兼容性很好，但 agent 会为此承担额外上下文成本：

- 工具目录通常会一次性暴露出来
- 工具 schema 往往比较冗长
- 长会话里反复发现工具和读取大输出，会持续推高 prompt 体积

这对 agent 很关键，因为 agent loop 天生受上下文窗口约束。OpenAI 的 Codex agent loop 文档明确提到 prompt 会持续增长，并需要做 context compaction；Claude Code 的 MCP 文档也明确提到会对大 MCP 输出给出警告，并支持动态刷新工具列表。

CLI 模式把 agent 的工作方式从：

- “先把整个工具面挂进来”

改成：

- “先看当前有哪些服务器”
- “只展开一个服务器”
- “只检查一个工具”
- “最后执行这个工具”

这就是工具层面的渐进式披露。

## 1MCP CLI 模式如何工作

你的 MCP 服务器仍然待在原来的位置：`1mcp serve` 背后。

然后让 agent 按以下顺序工作：

```bash
1mcp instructions
1mcp inspect <server>
1mcp inspect <server>/<tool>
1mcp run <server>/<tool> --args '<json>'
```

每一步都会继续收窄上下文：

- `instructions` 给出 playbook 和当前服务器清单
- `inspect <server>` 只列出一个服务器的工具
- `inspect <server>/<tool>` 只展示一个工具的 schema
- `run` 只执行这个已确认的工具调用

从用户视角看，主要需要执行的命令是 `1mcp cli-setup`。`instructions`、`inspect`、`run` 主要是给 AI agent 在引导完成后执行的，当然用户也可以手动运行它们来验证流程。

## MCP 在后端，CLI 在前端

最清晰的心智模型是：

- MCP 是后端互操作层
- `serve` 是聚合运行时
- CLI 模式是面向 agent 的前端工作流

底层仍然自然映射到 MCP 的 `tools/list` 与 `tools/call` 等原语。1MCP 并没有发明新的工具协议，而是为 agent 提供了一条更节制、更渐进的使用路径。

## 从直接 MCP 自然迁移

如果你已经在 agent 里直接使用 MCP，这个迁移过程应该是自然的：

1. 保留你现有的 MCP 服务器。
2. 用当前配置文件或 `1mcp mcp add ...` 把它们放到 1MCP 后面。
3. 移除该 agent 现有的直接 MCP server 配置。
4. 启动 `1mcp serve`。
5. 运行 `1mcp cli-setup --codex` 或 `1mcp cli-setup --claude`。
6. 让 agent 使用 `instructions`、`inspect`、`run`，而不是在上下文中直接携带完整 MCP 工具面。

关键点在这里：你不是重建整套 MCP 生态，而是在改变 agent 接近它的方式。

## 只能选择一种模式

对于每个 agent，只能选择以下两种模式之一：

- 直接 MCP 模式：agent 直接连接 MCP server
- CLI 模式：agent 不再保留直接 MCP server 配置，而是改用 1MCP CLI 工作流

对于 AI agent，我们推荐 CLI 模式，因为它给 agent 的工作面更薄、更可控。

## 推荐引导方式

用户应当在每台机器或每个仓库执行一次 `cli-setup`：

```bash
1mcp cli-setup --codex
1mcp cli-setup --claude --scope repo --repo-root .
```

它会安装引导文档和 hooks，让 agent 从 `instructions` 开始。它是对实时 `instructions` 命令的补充，而不是替代。

引导完成后，通常由 AI agent 执行以下命令：

```bash
1mcp instructions
1mcp inspect filesystem
1mcp inspect filesystem/read_file
1mcp run filesystem/read_file --args '{"path":"./mcp.json"}'
```

你也可以手动运行这些命令来验证配置，但预期模式是：用户执行 `cli-setup`，agent 执行后续工作流命令。

## 什么时候优先使用 CLI 模式

在以下情况，优先使用 CLI 模式：

- 客户端是自主或半自主的 coding agent
- 你希望更严格地控制工具发现范围
- 你希望长会话里减少 schema 和工具噪音
- 你希望跨机器、跨团队使用一致、可脚本化的工作流

对于原生面向 MCP 的客户端，直接 MCP 暴露依然有意义。但对于 agent 会话，CLI 模式应该是默认更优路径，而且应当替代该 agent 的直接 MCP 配置，而不是与之并存。

## 参考资料

- [Model Context Protocol schema：`tools/list` 与 `tools/call`](https://modelcontextprotocol.io/specification/draft/schema)
- [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)
- [OpenAI：Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)

## 另请参阅

- [Codex 集成](./codex.md)
- [开发者工具](./developer-tools.md)
- [Instructions 命令](/zh/commands/instructions.md)
- [Inspect 命令](/zh/commands/inspect.md)
- [Run 命令](/zh/commands/run.md)
