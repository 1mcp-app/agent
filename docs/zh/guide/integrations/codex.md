---
title: Codex 集成
description: 为 Codex 选择一种 1MCP 工作流：CLI 模式、直接 HTTP 或 stdio 代理。
---

# Codex 集成

当前 Codex 支持在受信任项目的 `.codex/config.toml` 中配置 MCP。当 MCP server 只属于该仓库时，请使用项目级文件；个人默认设置请使用 `~/.codex/config.toml`。有关信任和配置作用域，请参阅官方 [Codex 配置参考](https://developers.openai.com/codex/config-reference/#configtoml)。

每个 Codex 项目只能选择一种面向 agent 的 1MCP 模式。不要同时启用直接 HTTP 条目、代理条目和 CLI 工作流：它们会暴露重复的工具面，并让工具选择变得不明确。

| 模式 | 适用场景 | 不要配置 |
| --- | --- | --- |
| CLI 模式 | Codex 应通过引导说明渐进使用 1MCP 命令。 | Codex 中的 1MCP MCP server 条目。 |
| 直接 HTTP | 受信任项目只需要聚合的 1MCP MCP 端点。 | 同一项目的 `1mcp proxy`。 |
| Stdio 代理 | 项目需要 `.1mcprc` 预设/过滤选择或 stdio 桥接。 | 同一项目的直接 HTTP 条目。 |

下列示例均使用默认 1MCP 端口 `3050`。如果 `1mcp serve` 运行在其他端口，请保持替换后的端口一致。

## CLI 模式

CLI 模式适用于通过引导说明完成指令、发现和调用，而不把 1MCP 本身注册为 Codex MCP server：

```bash
1mcp cli-setup --codex
```

该命令会安装 1MCP Codex 引导文件，并打印必需的 Codex `config.toml` hook 与沙箱改动。请在启动新的 Codex 会话前应用输出的片段。保持会话工作流明确：

```bash
1mcp instructions
1mcp inspect <server>
1mcp inspect <server>/<tool>
1mcp run <server>/<tool> --args '<json>'
```

使用此模式前，请从同一 Codex 作用域移除已有的 1MCP MCP server 条目。

## 直接 HTTP

直接 HTTP 是最简单的受信任项目 MCP 连接方式。启动 1MCP 运行时，然后把该条目放入项目的受信任 `.codex/config.toml`（个人默认设置则放入用户配置）：

```bash
1mcp serve
```

```toml
[mcp_servers.1mcp]
url = "http://localhost:3050/mcp"
```

修改 Codex 配置后，请重启或新开一个 Codex 会话。此路径直接使用聚合端点，不会应用 `.1mcprc` 预设或过滤选择。

## Stdio 代理

需要 `.1mcprc` 选择时，请使用代理。在项目根目录创建选择文件，并且只配置代理条目：

```json
// .1mcprc
{
  "preset": "codex-development"
}
```

```bash
1mcp preset create codex-development --filter "files OR git OR collaboration"
1mcp serve
```

```toml
# 受信任项目的 .codex/config.toml
[mcp_servers.1mcp]
command = "npx"
args = ["-y", "@1mcp/agent", "proxy", "--url", "http://localhost:3050/mcp"]
```

请从该项目根目录启动 Codex，使代理读取对应的 `.1mcprc`。不要同时添加直接 HTTP 条目。

## 验证所选模式

排查 Codex 前，请先检查运行时：

```bash
curl http://localhost:3050/health
1mcp mcp status
```

使用直接 HTTP 或代理模式时，请新开 Codex 会话并检查已配置的 MCP server。使用 CLI 模式时，请运行 `1mcp instructions` 并遵循返回的服务器和工具检查路径。如果运行时启用了身份验证，请为端点配置相应的 MCP 客户端身份验证；代理和 CLI 模式不会绕过该运行时策略。

相关指南：[CLI 模式](/zh/guide/integrations/cli-mode)、[Proxy 命令](/zh/commands/proxy) 和[身份验证](/zh/guide/advanced/authentication)。
