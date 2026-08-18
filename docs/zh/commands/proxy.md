---
title: Proxy 命令
description: 将本地 stdio 客户端连接到运行中的 1MCP HTTP 运行时。
---

# Proxy 命令

`1mcp proxy` 是建立在运行中 1MCP 运行时之上的“最大兼容性”桥接路径。

它把本地 stdio 传输连接到一个正在运行的 `1mcp serve` HTTP 运行时。实际使用中，它通常是 CLI 模式之后最推荐的回退路径，因为大多数 AI 客户端都支持 stdio，而支持 streamable HTTP、SSE 或 CLI 模式的客户端要少得多。

## 先选对路径

1MCP 目前有三条不同路径：

1. **Agent loop 的 CLI 模式**：推荐给 Codex、Claude 以及类似的 agent 会话。
2. **`proxy`**：当你希望在保留项目上下文的同时获得最广兼容性时，推荐使用。
3. **直接 streamable HTTP MCP 接入**：当客户端可以直接连接，且你不需要项目上下文时使用。

`proxy` 不是主产品体验。对于 agent loop，CLI 模式仍然是一优先路径。`proxy` 的定位是最好的非 CLI 路径，兼顾 stdio 兼容性、`.1mcprc` 与模板服务器支持。

## 概要

```bash
1mcp proxy [选项]
```

## `proxy` 实际做了什么

- 发现一个运行中的 `1mcp serve` 实例
- 将 stdio MCP 流量转发到该 HTTP 运行时
- 在暴露桥接后的服务清单前，应用 preset、filter 或 tags 选择

真正的运行时仍然是 `serve`，`proxy` 不会取代它。

## 自动发现

`proxy` 可以通过以下方式发现运行中的运行时：

1. 用户显式传入 `--url`
2. 基于 PID 文件发现
3. 基于 localhost 端口扫描兜底

如果存在项目配置，`proxy` 还会合并 `.1mcprc` 中的设置。

## 使用 `.1mcprc` 做项目级配置

如果你经常把同一个项目或客户端桥接到相同的 preset 或过滤视图，可以使用 `.1mcprc`。

示例：

```json
{
  "preset": "development"
}
```

优先级顺序：

1. 命令行选项
2. `.1mcprc`
3. 默认值

## 常用选项

### 连接

- **`--url, -u <url>`**：覆盖自动发现的运行时地址。
- **`--context <name>`**：使用具名 Runtime Target Context；存在保存的 bearer token 时一并使用。
- **`--config-dir, -d <path>`**：在发现运行时时使用特定配置目录。

### 暴露控制

- **`--preset, -P <name>`**：从运行中的运行时选择一个预设。
- **`--filter, -f <expression>`**：应用过滤表达式。
- **`--tags <tags>`**：应用简单的逗号分隔标签。

### 日志

- **`--log-level <level>`**：设置日志详细程度。
- **`--log-file <path>`**：把日志写入文件。

## 示例

### 适合的用法：最大兼容性的 stdio 路径

```bash
# shell 1
1mcp serve

# shell 2
1mcp proxy
```

### 适合的用法：桥接到某个预设

```bash
1mcp proxy --preset development
```

### 适合的用法：桥接到带过滤的运行时

```bash
1mcp proxy --filter "web AND api"
```

### Windows MCP 客户端配置

部分受影响的 Windows MCP 客户端在启动 npm 的 `1mcp.cmd` shim 时，可能无法可靠地传递参数。对于这些客户端，请直接使用打包的 Windows 可执行文件。按照 [Windows 二进制安装说明](/zh/guide/installation) 操作后，将 `command` 设置为解压后的可执行文件绝对路径：

```json
{
  "mcpServers": {
    "1mcp": {
      "command": "C:\\Tools\\1mcp\\1mcp-win32-x64.exe",
      "args": ["proxy"]
    }
  }
}
```

请将示例路径替换为可执行文件的实际位置。此配置会直接调用 `proxy`，不依赖客户端启动 npm 的 `.cmd` shim。如有需要，可在 `args` 数组的 `"proxy"` 后添加 `"--preset", "development"` 或 `"--url", "http://127.0.0.1:3050/mcp"` 等选项。

上述可执行文件名与参数形式已通过发布打包流程和确定性测试核对。本次更改未在真实 Windows 主机上实际运行这一客户端启动路径。

### 对 agent，应优先使用 CLI 模式而不是 `proxy`

如果客户端本身是 agent 会话，更推荐：

```bash
1mcp cli-setup --codex
# 或
1mcp cli-setup --claude --scope repo --repo-root .
```

然后让 agent 使用：

```bash
1mcp instructions
1mcp inspect <server>
1mcp inspect <server>/<tool>
1mcp run <server>/<tool> --args '<json>'
```

### 只有在不需要项目上下文时，才优先直接 HTTP

如果客户端本身支持 streamable HTTP MCP，而且你不需要项目上下文，直接连接运行时端点即可：

```text
http://127.0.0.1:3050/mcp?app=cursor
```

## 身份验证

`proxy --context <name>` 会解析具名 Runtime Target Context，并在存在时向运行时发送其保存的 bearer token。先创建并认证 context：

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp auth login --context prod --token "$TOKEN"
1mcp proxy --context prod
```

`proxy --url <url>` 是临时连接，不会加载或附加已保存的凭据，因此保持无凭据状态。stdio 客户端仍不会获得交互式 OAuth 浏览器流程；当代理需要调用 bearer 保护的运行时时，请使用具名 context。

## 另请参阅

- **[CLI 模式指南](/zh/guide/integrations/cli-mode)**
- **[Serve 命令](/zh/commands/serve)**
- **[Runtime Target Context 命令](/zh/commands/target)**
- **[Auth 命令](/zh/commands/auth)**
- **[架构](/zh/reference/architecture)**
