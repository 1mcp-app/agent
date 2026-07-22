---
title: Serve 命令
description: 启动 1MCP 主运行时，并将其用于 CLI 模式、原生 HTTP MCP 客户端以及模板感知的运行时行为。
---

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
- 为 `1mcp proxy` 提供带项目上下文的 stdio 兼容桥接目标

CLI 模式依赖一个正在运行的 `serve` 实例。

## 当前心智模型

`serve` 不只是切换传输类型的命令，它就是主运行时。

- 静态服务器从启动配置创建。
- 模板服务器会在后续按客户端或会话上下文创建。
- 异步加载允许 HTTP 入口先启动，再让静态服务器在后台继续加载。
- 懒加载允许在真正需要前保持更窄的暴露面。
- 指令聚合与预设通知都在这个运行时内部初始化。

关于完整的运行时配置，请参阅 **[配置指南](/zh/guide/essentials/configuration)**。

## 常用选项

### 配置

- **`--config, -c <path>`**：指定配置文件。
- **`--config-dir, -d <path>`**：指定配置目录。

### HTTP 运行时

- **`--port, -P <port>`**：修改 HTTP 端口，默认 `3050`。
- **`--host, -H <host>`**：修改绑定地址，默认 `localhost`。
- **`--external-url <url>`**：设置外部基础 URL，常用于认证相关流程。

### 过滤与预设

- **`--filter, -f <expression>`**：使用简单的逗号分隔标签或高级布尔表达式筛选暴露的服务器。

### 安全

- **`--enable-auth`**：为运行时启用基于 OAuth 的认证。
- **`--enable-enhanced-security`**：启用额外的安全中间件。
- **`--trust-proxy <config>`**：配置受信任反向代理行为。

### 运行时行为

- **`--enable-async-loading`**：让 HTTP 可用性先启动，再等待静态服务器完成加载。
- **`--enable-lazy-loading`**：为服务能力启用懒加载行为。
- **`--enable-config-reload`**：启用配置重载处理。
- **`--enable-session-persistence`**：启用 HTTP 会话持久化。

### 生命周期

- **`--background`**：将 HTTP Aggregated Runtime 以分离的后台进程方式为所选 **Runtime Scope（运行时作用域）** 启动，待其就绪后返回。仅支持 HTTP。
- **`--status`**：报告所选 **Runtime Scope（运行时作用域）** 中运行时的状态，然后退出，不启动服务器。
- **`--stop`**：停止所选 **Runtime Scope（运行时作用域）** 中的运行时，然后退出。
- **`--restart`**：停止所选 **Runtime Scope（运行时作用域）** 中的运行时（如果正在运行），然后启动一个全新的分离后台运行时。仅支持 HTTP。

## 运行时作用域与生命周期

**Runtime Scope（运行时作用域）** 即配置目录。运行时的唯一性以配置目录为界，而非整台机器：默认配置目录是默认的 Runtime Scope，而通过 `--config-dir` 指定的其他目录则是独立的 Runtime Scope，可运行各自的运行时。

### 后台启动

`1mcp serve --background` 会以分离进程方式启动运行时，待其就绪后返回，从而让脚本得以继续执行：

```bash
1mcp serve --background
1mcp serve --background --config-dir ./config --port 3051
```

在等待期间，它会向 stderr 打印实时进度（已用时间，以及运行时启动后已就绪的上游服务器数量），因此启动过程不会静默无声。成功时会打印 PID、URL、日志文件和服务器数量，并以 `0` 退出：

```text
Background runtime started.
PID: 48213
URL: http://localhost:3050/mcp
Log file: /home/me/.config/1mcp/logs/server.log
Servers: 3/5 ready
```

行为说明：

- **仅支持 HTTP。** 会拒绝 `--transport stdio`（stdio 无法分离）。`sse` 会被规整为 HTTP，运行时记录 `transport: http`。
- **快速分离。** 在默认的同步模式下，命令会等待所有上游服务器连接完成后才返回，因此等待时间取决于最慢的那个。添加 `--enable-async-loading` 可先绑定 HTTP 入口并在不到一秒内返回，上游服务器则在后台继续加载。
- **确定性日志。** 当未配置 `--log-file` 或 `logging.file` 时，后台日志默认写入 `<config-dir>/logs/server.log`。
- **幂等。** 若该 Runtime Scope 中已有运行时在运行（前台或后台），则报告该运行时并以 `0` 退出，不会启动第二个。不同的 `--config-dir` 属于不同作用域，可各自运行独立的运行时。
- **已占用但未就绪。** 若该作用域已被某运行时占用但尚未通过 `/health/ready`，`--background` 会拒绝启动第二个并以非零码退出。请先检查 `--status` 或将其停止。
- **孤儿恢复。** 指向已死进程的 PID 文件不会阻止启动；它会被视为过期并替换。
- **失败处理。** 若运行时未能到达 `/health/ready`，命令会打印日志路径、终止已派生的进程，并以非零码退出。

### 查看运行时状态

`1mcp serve --status` 会发现所选 Runtime Scope 中占用的运行时并报告其状态：

```bash
1mcp serve --status
1mcp serve --status --config-dir ./config
```

它会打印 PID、URL、Runtime Scope、启动时间、日志文件、进程存活状态以及 `/health/ready` 就绪状态：

```text
Runtime Scope: /home/me/.config/1mcp
Status: running (ready)
PID: 48213
URL: http://localhost:3050/mcp
Started: 2026-06-26T00:00:00.000Z
Log file: /home/me/.config/1mcp/logs/server.log
Process: alive
Readiness (/health/ready): ready
```

退出码会反映状态，方便脚本据此分支：

- `0` —— 正在运行且已就绪
- `3` —— 未运行（作用域为空，或指向已死进程的过期 PID 文件已被清理）
- `4` —— 存活但尚未就绪（进程已启动，但 `/health/ready` 尚未通过，例如正在启动中）

`--status` 为只读操作。指向已死进程的 PID 文件会被删除；而存活但尚未就绪的运行时会保留其 PID 文件，从而不会让仍在启动中的运行时被误清理。

### 停止运行时

`1mcp serve --stop` 仅停止所选 Runtime Scope 中的运行时：

```bash
1mcp serve --stop
1mcp serve --stop --config-dir ./config
```

它会发现该作用域内的运行时，向其进程发送优雅终止信号，短暂等待其退出（必要时升级处理），并删除 PID 文件：

```text
Stopped runtime in Runtime Scope /home/me/.config/1mcp (PID 48213).
```

行为说明：

- **作用域隔离。** 只会向所选 Runtime Scope 记录的运行时发送信号；不同 `--config-dir` 的运行时绝不会受影响。
- **空闲时干净处理。** 若没有运行中的运行时，会如实报告并以 `0` 退出；若存在过期 PID 文件，则一并删除。

### 重启运行时

`1mcp serve --restart` 会停止所选 Runtime Scope 中的运行时（如果有），然后启动一个全新的分离后台运行时：

```bash
1mcp serve --restart
1mcp serve --restart --config-dir ./config --port 3051
```

它由 `--stop` 与 `--background` 组合而成，因此接受与 `--background` 相同的 HTTP 选项，并打印相同的启动进度与启动报告。

行为说明：

- **始终以运行状态结束。** 遵循 `systemctl restart` 语义：对空作用域而言，先执行一次干净的空操作停止，再进行冷启动，因此一次成功的重启总会让运行时处于运行状态并以 `0` 退出。
- **仅支持 HTTP。** 与 `--background` 一样，`--transport stdio` 会被拒绝。
- **安全交接。** 若已有运行时无法被停止（升级处理后仍存活），重启会在启动前中止并以非零码退出，从而避免两个运行时争用同一作用域。

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

### 启动时筛选服务器暴露面

```bash
1mcp serve --filter "web,api"
1mcp serve --filter "(web OR api) AND production"
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

当客户端能够对 HTTP 运行时完成认证时，再使用这种方式。不要假设无法完成 HTTP 认证的 stdio 客户端在这种配置下仍能通过 `proxy` 正常工作。

## 相关命令

- **`1mcp cli-setup --codex`**
- **`1mcp cli-setup --claude --scope repo --repo-root .`**
- **`1mcp instructions`**
- **`1mcp inspect <server>`**
- **`1mcp inspect <server>/<tool>`**
- **`1mcp run <server>/<tool> --args '<json>'`**
- **`1mcp proxy`**

## 另请参阅

- **[CLI 模式指南](/zh/guide/integrations/cli-mode)**
- **[Proxy 命令](/zh/commands/proxy)**
- **[使用 Caddy 进行云端部署](/zh/guide/advanced/cloud-deployment)**
- **[架构](/zh/reference/architecture)**
- **[配置指南](/zh/guide/essentials/configuration)**
