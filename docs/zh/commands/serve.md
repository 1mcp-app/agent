# Serve 命令

`1mcp serve` 用于启动 1MCP 的主运行时。

它负责聚合你配置好的 MCP 服务器、暴露 HTTP MCP 入口、初始化预设与指令聚合，并在获得客户端或会话上下文后解析模板服务器。

## 概要

```bash
1mcp serve [选项]
1mcp [选项]
```

`serve` 是默认命令。

## 什么时候使用 `serve`

当你需要以下能力时，都应该启动 `serve`：

- 运行聚合式 1MCP 运行时
- 为 agent 提供 CLI 模式所依赖的后端
- 为原生 HTTP MCP 客户端暴露直接接入点
- 为 `1mcp proxy` 提供 stdio 兼容桥接目标

CLI 模式依赖一个正在运行的 `serve` 实例。

## 当前心智模型

`serve` 不只是切换传输类型的命令，它就是主运行时。

- 静态服务器从启动配置创建。
- 模板服务器会在后续按客户端或会话上下文创建。
- 异步加载允许 HTTP 入口先启动，再让静态服务器在后台继续加载。
- 懒加载允许在真正需要前保持更窄的暴露面。
- 指令聚合与预设通知都在这个运行时内部初始化。

关于完整的运行时配置，请参阅 **[配置指南](../guide/essentials/configuration.md)**。

## 常用选项

### 配置

- **`--config, -c <path>`**：指定配置文件。
- **`--config-dir, -d <path>`**：指定配置目录。

### HTTP 运行时

- **`--port, -P <port>`**：修改 HTTP 端口，默认 `3050`。
- **`--host, -H <host>`**：修改绑定地址，默认 `localhost`。
- **`--external-url <url>`**：设置外部基础 URL，常用于认证相关流程。

### 过滤与预设

- **`--tag-filter, -f <expression>`**：应用高级标签过滤表达式。
- **`--tags <tags>`**：简单标签输入。更推荐 `--tag-filter`。

### 安全

- **`--enable-auth`**：为运行时启用基于 OAuth 的认证。
- **`--enable-enhanced-security`**：启用额外的安全中间件。
- **`--trust-proxy <config>`**：配置受信任反向代理行为。

### 运行时行为

- **`--enable-async-loading`**：让 HTTP 可用性先启动，再等待静态服务器完成加载。
- **`--enable-lazy-loading`**：为服务能力启用懒加载行为。
- **`--enable-config-reload`**：启用配置重载处理。
- **`--enable-session-persistence`**：启用 HTTP 会话持久化。

## 示例

### 启动运行时

```bash
1mcp serve
```

### 在运行时之上执行 agent 工作流

```bash
# shell 1
1mcp serve

# shell 2
1mcp instructions
1mcp inspect context7
1mcp inspect context7/query-docs
1mcp run context7/query-docs --args '{"libraryId":"/mongodb/docs","query":"aggregation pipeline"}'
```

### 使用特定配置启动

```bash
1mcp serve --config ./mcp.json
1mcp serve --config-dir ./config
```

### 启用异步加载与懒加载

```bash
1mcp serve --enable-async-loading --enable-lazy-loading
```

### 为直接 HTTP MCP 客户端启动运行时

```bash
1mcp serve --host 0.0.0.0 --port 3051
```

然后让原生 MCP 客户端连接：

```text
http://127.0.0.1:3051/mcp?app=cursor
```

### 启用认证启动

```bash
1mcp serve --enable-auth --external-url https://mcp.example.com
```

当客户端能够对 HTTP 运行时完成认证时，再使用这种方式。不要假设 stdio-only 客户端在这种配置下仍能通过 `proxy` 正常工作。

## 相关命令

- **`1mcp cli-setup --codex`**
- **`1mcp cli-setup --claude --scope repo --repo-root .`**
- **`1mcp instructions`**
- **`1mcp inspect <server>`**
- **`1mcp inspect <server>/<tool>`**
- **`1mcp run <server>/<tool> --args '<json>'`**
- **`1mcp proxy`**

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)**
- **[Proxy 命令](./proxy.md)**
- **[架构](../reference/architecture.md)**
- **[配置指南](../guide/essentials/configuration.md)**
