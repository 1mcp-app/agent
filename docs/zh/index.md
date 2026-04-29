---
layout: home
title: '1MCP Agent - 统一 MCP 运行时与面向 Agent 的 CLI 模式'
description: '用 1MCP 运行一个聚合式 MCP 运行时，并为 Codex、Claude 等 agent 提供更薄的 CLI 工作流。'
head:
  - [
      'meta',
      { name: 'keywords', content: '1MCP,MCP 运行时,CLI 模式,agent 工作流,Codex,Claude,模板服务器,异步加载,懒加载' },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Agent - 统一 MCP 运行时' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: '在 1mcp serve 后面聚合多个 MCP 服务器，并为 agent 会话提供渐进式 CLI 工作流。',
      },
    ]
  - ['meta', { name: 'twitter:title', content: '1MCP Agent - 统一 MCP 运行时' }]
  - [
      'meta',
      {
        name: 'twitter:description',
        content: '统一 MCP 运行时，加上面向 Codex、Claude 与直接 MCP 客户端的 CLI 模式。',
      },
    ]

hero:
  name: '1MCP Agent'
  text: '一个 MCP 运行时，一条更薄的 agent 工作流'
  tagline: '在 `1mcp serve` 后运行你的 MCP 服务器，再让 agent 用 CLI 模式按需发现工具，而不是把完整工具面一次性塞进上下文。'
  image:
    src: /images/logo.png
    alt: 1MCP Agent Logo
  actions:
    - theme: brand
      text: 5 分钟上手
      link: /zh/guide/quick-start
    - theme: alt
      text: CLI 模式
      link: /zh/guide/integrations/cli-mode
    - theme: alt
      text: 架构
      link: /zh/reference/architecture

features:
  - icon: 🧭
    title: 渐进式 CLI 发现
    details: 'agent 从 `instructions` 开始，用 `inspect` 收窄范围，只在真正需要时才执行具体工具。'
  - icon: 🧩
    title: 统一运行时
    details: '`1mcp serve` 在一个运行时后面聚合静态与模板化 MCP 服务器。'
  - icon: 🪄
    title: 上下文感知模板
    details: 模板服务器可以按客户端或会话创建，而不是在启动时固定死。
  - icon: ⚡
    title: 异步加载与懒加载
    details: 更快启动、后台加载，并在真正需要前保持更窄的暴露面。
  - icon: 📦
    title: 预设与过滤
    details: 在项目、客户端和兼容桥之间复用同一套服务集合，而无需复制配置。
  - icon: 🔐
    title: 直接 HTTP 与兼容路径
    details: '同时支持直接 HTTP MCP 接入，以及为 stdio-only 客户端准备的 `proxy`。'
---

## 为什么选择 1MCP？

1MCP 同时解决两类问题：

- **配置蔓延**：不同客户端各自维护一套 MCP 配置。
- **Agent 上下文蔓延**：太多工具与 schema 在长会话里被一次性注入上下文。

当前产品心智模型是：

- `1mcp serve` 是统一运行时。
- CLI 模式是这个运行时之上的、推荐给 agent 的工作流。
- 直接 MCP 接入仍然为原生 MCP 客户端保留。

把这个首页当成分流页。如果你已经确定要先跑通一个可工作的流程，直接去看[快速入门](/zh/guide/quick-start)。

## 如果你在用 AI Agent，请从这里开始

这个首页优先面向 Codex、Claude、Cursor 等 agent 工作流。默认路径是：添加一个真实上游 MCP server，启动 `1mcp serve`，运行 `cli-setup`，然后验证 `instructions -> inspect -> run`。

## 先选对路径

- 想最快跑通一个 agent 工作流？看[快速入门](/zh/guide/quick-start)。
- 想理解 `instructions`、`inspect`、`run` 的工作方式？看 [CLI 模式](/zh/guide/integrations/cli-mode)。
- 想让原生 MCP 客户端直接连运行时？看 [serve](/zh/commands/serve)。
- 想了解运行时、模板与加载行为？看[架构](/zh/reference/architecture)。

## 5 分钟上手预览

```bash
npm install -g @1mcp/agent
1mcp mcp add context7 -- npx -y @upstash/context7-mcp
1mcp serve
```

用 CLI 模式连接你的 agent：

```bash
1mcp cli-setup --codex
# 或
1mcp cli-setup --claude --scope repo --repo-root .
```

验证工作流：

```bash
1mcp instructions
1mcp inspect context7
1mcp inspect context7/query-docs
1mcp run context7/query-docs --args '{"libraryId":"/mongodb/docs","query":"aggregation pipeline"}'
```

这里仅提供预览路径。若要查看前置条件、成功标准和常见问题，请继续阅读[快速入门](/zh/guide/quick-start)。

## 为什么推荐这条路径

- **更薄的 agent 工作面**：渐进式发现避免把整个工具目录直接灌进上下文。
- **一个运行时服务多个客户端**：agent、直接 HTTP MCP 客户端、stdio 兼容桥都可以共用同一份后端能力。
- **符合当前产品现实，而不是旧式代理叙事**：异步加载、懒加载、模板、指令和预设都已经是主系统设计的一部分。

## 选择其他路径

<div class="vp-feature-grid">
  <a href="/zh/guide/quick-start" class="vp-feature-box">
    <h3>Agent 快速入门</h3>
    <p>适合第一次上手的 agent 用户，先拿到一个可运行的结果，再去看架构和运维细节。</p>
  </a>

  <a href="/zh/guide/integrations/cli-mode" class="vp-feature-box">
    <h3>Agent 的 CLI 模式</h3>
    <p>适合 Codex、Claude 以及其他希望渐进式发现工具的 agent loop。</p>
  </a>

  <a href="/zh/commands/serve" class="vp-feature-box">
    <h3>直接使用运行时</h3>
    <p>适合能直接连接聚合运行时的原生 HTTP MCP 客户端。</p>
  </a>

  <a href="/zh/commands/proxy" class="vp-feature-box">
    <h3>stdio 兼容桥</h3>
    <p>只有在客户端无法直接连接 HTTP 运行时时，才使用 `proxy`。</p>
  </a>
</div>

<style>
.vp-feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
  margin-top: 2rem;
}

.vp-feature-box {
  padding: 1.5rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  text-decoration: none;
  transition: border-color 0.25s;
}

.vp-feature-box:hover {
  border-color: var(--vp-c-brand);
}

.vp-feature-box h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
}

.vp-feature-box p {
  margin: 0;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}
</style>
