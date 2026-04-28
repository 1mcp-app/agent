# Proxy 命令

`1mcp proxy` 是为 stdio-only 客户端准备的兼容桥。

它把本地 stdio 传输连接到一个正在运行的 `1mcp serve` HTTP 运行时。当客户端不能直接连接 HTTP MCP 端点时，这个命令才有意义。

## 先选对路径

1MCP 目前有三条不同路径：

1. **Agent loop 的 CLI 模式**：推荐给 Codex、Claude 以及类似的 agent 会话。
2. **直接 HTTP MCP 接入**：推荐给能直接连接运行时的原生 MCP 客户端。
3. **`proxy`**：只在客户端受限于 stdio 时使用。

`proxy` 不是主产品体验，它存在的意义是兼容旧客户端或 stdio-only 客户端。

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

如果你经常把同一个 stdio-only 客户端桥接到相同的 preset 或过滤视图，可以使用 `.1mcprc`。

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
- **`--config-dir, -d <path>`**：在发现运行时时使用特定配置目录。

### 暴露控制

- **`--preset, -P <name>`**：从运行中的运行时选择一个预设。
- **`--filter, -f <expression>`**：应用过滤表达式。
- **`--tags <tags>`**：应用简单的逗号分隔标签。

### 日志

- **`--log-level <level>`**：设置日志详细程度。
- **`--log-file <path>`**：把日志写入文件。

## 示例

### 适合的用法：stdio 兼容桥

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

### 对原生 HTTP 客户端，应优先直接连接而不是 `proxy`

如果客户端本身支持 HTTP MCP，直接连接运行时端点即可：

```text
http://127.0.0.1:3050/mcp?app=cursor
```

## 认证注意事项

这是本页最重要的限制：

- stdio 传输不会给客户端带来 OAuth 浏览器认证流程
- `proxy` 不会神奇地让 stdio-only 客户端变得“支持认证”
- 如果运行时要求认证，stdio-only 客户端无法通过 `proxy` 使用它

实际建议是：

- 对 agent loop，尽量使用 CLI 模式
- 对可认证的客户端，优先使用直接 HTTP
- 只在运行时不要求认证时使用 `proxy`
- 如果 stdio-only 客户端仍然需要兼容接入，请单独运行一个不启用认证的 `serve` 实例

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)**
- **[Serve 命令](./serve.md)**
- **[架构](../reference/architecture.md)**
