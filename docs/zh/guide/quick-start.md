---
title: 快速入门指南 - 面向 Agent 的 1MCP 5 分钟上手
description: 面向 Codex、Claude、Cursor 等 agent，在 5 分钟内完成 1MCP 上手：启动 serve，执行 cli-setup，并验证 instructions、inspect 和 run。
head:
  - ['meta', { name: 'keywords', content: '1MCP 快速入门,CLI 模式,Codex,Claude,Cursor,agent 设置,教程' }]
  - ['meta', { property: 'og:title', content: '1MCP 快速入门指南 - 面向 Agent 的 5 分钟设置' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: '用适合 agent 的方式在 5 分钟内跑通 1MCP：serve、cli-setup、instructions、inspect、run。',
      },
    ]
---

# 快速入门

这个页面优先面向 AI agent 用户。它的职责很单一：让你拿到一个可运行的 `1mcp serve` 运行时，并验证一次 CLI 模式工作流。

完成本指南后，你会得到：

- 一个已经添加到 1MCP 的真实上游 MCP server
- 一个正在运行的 `1mcp serve` 实例
- 已通过 `cli-setup` 接入的 Codex 或 Claude
- 一个已验证的 `instructions -> inspect -> run` 工作流

如果你要看直接 MCP 接入、stdio 兼容桥，或更深入的运行时运维说明，请跳到[选择其他路径](#选择其他路径)。

## 先决条件

- Node.js 18+
- 一个 AI agent 客户端，例如 Codex 或 Claude

## 5 分钟 Agent 设置

### 1. 安装 1MCP

```bash
npm install -g @1mcp/agent
```

### 2. 添加一个真实的上游 MCP server

先用一个可识别、便于验证的例子：

```bash
1mcp mcp add context7 -- npx -y @upstash/context7-mcp
```

### 3. 启动运行时

```bash
1mcp serve
```

保持这个 shell 运行，然后打开第二个 shell 继续。

### 4. 用 `cli-setup` 连接你的 agent

二选一：

```bash
1mcp cli-setup --codex
```

```bash
1mcp cli-setup --claude --scope repo --repo-root .
```

这个命令会安装引导文件，让 agent 按顺序使用 `instructions`、`inspect` 和 `run`。目标类型和作用域细节见 [`cli-setup`](/zh/commands/cli-setup)。

### 5. 验证工作流

运行与你的 agent 将使用的同一组命令：

```bash
1mcp instructions
1mcp inspect context7
1mcp inspect context7/query-docs
1mcp run context7/query-docs --args '{"libraryId":"/mongodb/docs","query":"aggregation pipeline"}'
```

### 成功的样子

- `instructions` 会解释 CLI 工作流，并展示当前运行时上下文
- `inspect context7` 能列出上游 server 的工具
- `inspect context7/query-docs` 会在调用前展示 schema
- `run ...` 会返回来自上游 server 的真实结果

到这里，你的 agent 已经可以在不额外阅读其他设置页面的前提下，通过 CLI 模式使用 1MCP。

## 这个页面不覆盖什么

- 完整运行时配置
- 鉴权与团队部署
- 直接 HTTP MCP 接入细节
- `proxy` 与仅支持 stdio 的兼容流程

当第一条工作流跑通后，再去看下面链接到的深入页面。

## 为什么推荐这条路径

对 agent 会话来说，CLI 模式是拿到工作结果的最窄路径：

- `1mcp serve` 在后台提供一个统一运行时
- `cli-setup` 为 agent 安装引导文件
- `instructions -> inspect -> run` 让工具暴露保持渐进，而不是一开始就全部展开

## 选择其他路径

### 直接 MCP 接入

如果你的客户端已经原生支持 MCP，而且你不想使用 CLI 模式，请走这条路径。

- [Serve 命令](/zh/commands/serve)
- [架构说明](/zh/reference/architecture)

### stdio 兼容

如果你的客户端无法直接连接 HTTP 运行时，请走这条路径。

- [Proxy 命令](/zh/commands/proxy)

### 运行时运维

当基础流程跑通后，再来看这些运行时管理文档：

- [配置](/zh/guide/essentials/configuration)
- [认证](/zh/guide/advanced/authentication)
- [预设](/zh/commands/preset/)

## 下一步

- [CLI 模式指南](/zh/guide/integrations/cli-mode) 了解完整心智模型
- [添加更多服务器](/zh/guide/essentials/configuration) 扩展运行时能力
- [启用认证](/zh/guide/advanced/authentication) 用于共享或生产环境

## 常见问题

**`1mcp serve` 启动失败**

- 检查是否安装了 Node.js 18+：`node --version`
- 重新运行 `1mcp mcp list`，确认上游 server 已成功添加

**`cli-setup` 没有影响到我的 agent**

- 确认你选择了正确的目标：`--codex` 或 `--claude`
- 如果使用 repo 作用域，确认命令是在目标仓库根目录运行的

**`inspect` 看不到工具**

- 确认第一个 shell 里的 `1mcp serve` 还在运行
- 再次执行 `1mcp instructions`，确认当前运行时状态

**`run` 调用上游 server 失败**

- 重新执行 `1mcp inspect context7/query-docs`，检查必填参数
- 查看 `serve` 的输出，确认上游启动时没有报错
