---
title: 1MCP 入门指南
description: 选择受支持的 1MCP 上手路径，安装运行时并验证首次运行，然后进入配置、身份验证或部署的权威指南。
head:
  - ['meta', { name: 'keywords', content: '1MCP 入门,安装,首次运行,CLI 模式,OAuth 2.1,配置' }]
  - ['meta', { property: 'og:title', content: '1MCP 入门指南' }]
  - ['meta', { property: 'og:description', content: '选择受支持的 1MCP 上手路径并验证你的第一个运行时。' }]
---

# 1MCP 入门指南

本页用于选择并分阶段完成上手路径。它只保留一个精简的首次运行流程，然后把安装、配置、身份验证和部署细节导向各自的权威指南。

如果你只想走最短的面向 agent 路径，请从[快速入门](/zh/guide/quick-start)开始。

## 选择你的路径

- **Agent CLI 模式**：[快速入门](/zh/guide/quick-start)，包含 `serve`、`cli-setup` 与渐进式发现。
- **直接运行时**：通过[配置](/zh/guide/essentials/configuration)和 [serve 命令](/zh/commands/serve)运行 HTTP 运行时。
- **最大兼容性**：为需要项目上下文的 stdio 客户端使用 [Proxy 命令](/zh/commands/proxy)。
- **受保护的运行时**：通过[身份验证](/zh/guide/advanced/authentication)配置 OAuth 2.1 和作用域。
- **共享或公网部署**：阅读 [使用 Caddy 的云部署](/zh/guide/advanced/cloud-deployment)。

## 先决条件

- Linux、macOS 或 Windows
- 终端以及可写的配置目录
- npm 或源码安装需要 Node.js `^20.19.0 || ^22.12.0 || >=24.0.0`（与包的 `engines.node` 契约一致）

独立发布归档不需要本地 Node.js。贡献者应使用 `.node-version` 中的版本；它是仓库默认版本，而不是包的最低版本。

## 阶段 1：安装运行时

选择一种安装方式。[安装指南](/zh/guide/installation)是所有平台和 Docker 选项的权威来源。

### 发布归档

发布版本提供的是归档文件，而不是原始可执行文件下载。下载对应平台的归档，解压后运行其中的二进制文件：

```bash
# Linux x64
curl -LO https://github.com/1mcp-app/agent/releases/latest/download/1mcp-linux-x64.tar.gz
tar -xzf 1mcp-linux-x64.tar.gz
sudo install -m 0755 1mcp-linux-x64 /usr/local/bin/1mcp
1mcp --version

# macOS Apple Silicon
curl -LO https://github.com/1mcp-app/agent/releases/latest/download/1mcp-darwin-arm64.tar.gz
tar -xzf 1mcp-darwin-arm64.tar.gz
sudo install -m 0755 1mcp-darwin-arm64 /usr/local/bin/1mcp
1mcp --version
```

```powershell
# Windows x64
Invoke-WebRequest -Uri "https://github.com/1mcp-app/agent/releases/latest/download/1mcp-win32-x64.zip" -OutFile "1mcp-win32-x64.zip"
Expand-Archive -Path "1mcp-win32-x64.zip" -DestinationPath "."
.\1mcp-win32-x64.exe --version
```

其余已发布归档为 `1mcp-linux-arm64.tar.gz` 和 `1mcp-darwin-x64.tar.gz`。它们的精确命令、npm 和 Docker 说明见[安装](/zh/guide/installation)。

### npm

在受支持的 Node.js 运行时下，可以全局安装：

```bash
npm install -g @1mcp/agent
1mcp --version
```

## 阶段 2：验证第一个运行时

添加一个上游 MCP server 并启动运行时：

```bash
1mcp mcp add context7 -- npx -y @upstash/context7-mcp
1mcp serve
```

保持 `serve` 运行。在另一个 shell 中，确认运行时可以描述已连接的 server：

```bash
1mcp inspect context7
```

配置文件位置、选择器、环境变量和运行时选项请继续看[配置](/zh/guide/essentials/configuration)。要通过 CLI 模式连接 agent，请阅读[快速入门](/zh/guide/quick-start)。

## 阶段 3：连接客户端

对于 Codex 或 Claude，请按[快速入门](/zh/guide/quick-start)中的 agent 路径执行：

```bash
1mcp cli-setup --codex
```

对于 Codex，`cli-setup` 会打印必须加入 `config.toml` 的改动，但不会自动应用。请在打开下一次 Codex 会话前加入打印出的片段，然后验证 `instructions -> inspect -> run`。

对于非 CLI 的 stdio 客户端，请使用 [Proxy](/zh/commands/proxy)。对于不需要项目上下文的原生 HTTP MCP 客户端，请使用 [serve](/zh/commands/serve)。

## 阶段 4：按需添加身份验证

只在基础运行时跑通后再执行这一步。1MCP 支持动态客户端注册（DCR），随后使用带 PKCE 的授权码流程。请使用支持该浏览器授权流程的客户端或已测试工具；不要使用客户端凭据授权，也不要虚构客户端密钥。

如何启用运行时、通过 DCR 注册客户端、完成授权、配置作用域和排障，请阅读[身份验证指南](/zh/guide/advanced/authentication)。

## 阶段 5：有计划地部署

要部署共享或公网运行时，请继续阅读[使用 Caddy 的云部署](/zh/guide/advanced/cloud-deployment)。其中覆盖了生产部署所需的公网 HTTPS 地址、代理信任、Admin Console 和本地 CLI target 设置。

## 首次运行检查清单

- 通过所选安装方式，`1mcp --version` 可以成功执行
- `1mcp serve` 保持运行
- `1mcp inspect <server>` 能报告已配置的上游 server
- 下一篇指南与所选路径匹配：CLI 模式、配置、身份验证、代理或部署
