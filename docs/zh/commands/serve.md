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
- **`--template-context-trust <verified|disabled|legacy>`**：控制请求上下文能否渲染模板服务器，默认值为 `verified`。
- **`--confirm-untrusted-template-context`**：HTTP 绑定到非回环地址并使用 `legacy` 时必须显式提供。

`verified` 会继续为第一方本地 `run`、`inspect`、`wait` 和 `proxy` 客户端提供零配置模板渲染。未签名的远程或第三方客户端仍可连接并使用静态服务器，但其上下文不能影响模板的 `command`、`args`、`cwd` 或 `env`。`legacy` 会恢复历史上的未验证行为，只应作为临时兼容模式使用。

### 运行时行为

- **`--enable-async-loading`**：让 HTTP 可用性先启动，再等待静态服务器完成加载。
- **`--enable-lazy-loading`**：选择使用元工具逐步发现工具；省略该选项则直接暴露全部工具。
- **`--enable-config-reload`**：启用配置重载处理。
- **`--enable-session-persistence`**：启用 HTTP 会话持久化。

### 生命周期

- **`--background`**：为所选 **Runtime Scope（运行时作用域）** 启动持久化的 Background Runtime Supervisor 及其 HTTP Aggregated Runtime，待运行时就绪后返回。仅支持 HTTP。
- **`--status`**：报告所选 **Runtime Scope（运行时作用域）** 中运行时的状态，然后退出，不启动服务器。
- **`--stop`**：停止所选 **Runtime Scope（运行时作用域）** 中的运行时，然后退出。
- **`--restart`**：停止所选 **Runtime Scope（运行时作用域）** 中的运行时（如果正在运行），然后启动一个全新的分离后台运行时。仅支持 HTTP。

## 运行时作用域与生命周期

**Runtime Scope（运行时作用域）** 即配置目录。运行时的唯一性以配置目录为界，而非整台机器：默认配置目录是默认的 Runtime Scope，而通过 `--config-dir` 指定的其他目录则是独立的 Runtime Scope，可运行各自的运行时。

每个 Runtime Scope 只有一个具备竞态安全保证的生命周期所有者。若该作用域已被占用，普通的前台或后台 `serve` 命令都会以非零码退出；后台运行时正在重启或处于 `crash-loop` 时也不例外。需要主动替换时应使用 `--restart`。不同配置目录之间仍相互独立。

前台 HTTP 与已弃用的前台 stdio 启动都会遵守同一所有权规则，但不会受到后台 supervisor 的监督。对于需要 stdio 兼容性的客户端，请优先使用 `1mcp proxy`；后台模式仅支持 HTTP。

### 持久卷与进程身份

在 Linux 上，生命周期所有权同时使用内核文件锁和持久化的进程身份（系统启动 ID、PID 命名空间和进程启动时间）。系统必须提供 `flock` 命令；官方基于 Alpine 的 Docker 镜像已包含该命令。配置目录必须位于支持可靠、共享 `flock` 语义的存储上。缺少锁支持时，操作会被拒绝。

当前台 Docker 运行时被外部强制终止后，替代容器可以在同一持久卷上回收其遗留的所有权和停止操作记录，即使两个进程的 PID 都是 1。共享该卷的另一个存活容器仍持有内核锁，会阻止竞争启动。仅更改主机名不会获得接管权限。

稳定的 `runtime.owner.flock` 和 `runtime.stop.flock` 文件会在关闭后保留。文件存在不代表锁仍被持有。**只要可能还有进程使用该作用域，就不要删除这些文件**：替换它们的 inode 会破坏协调机制。

`server.pid`、所有权和 supervisor 元数据会记录进程启动身份。发现和停止命令会保留身份不明确的元数据，并拒绝向未经验证的进程发送信号。停止操作在从 SIGTERM 升级到 SIGKILL 前会再次检查进程身份。

兼容性与限制：

- **升级仍在运行的旧后台运行时：** macOS 和 Linux 上，显式执行 `serve --stop` 或 `serve --restart` 时，可通过操作系统进程信息验证旧 supervisor 与存活 worker 的所有权声明、父子关系、用户、执行上下文和作用域，再安全停止。发送信号及清理前会重新验证，先停止 supervisor；发现 worker 或所有者已更换时中止。不会改写旧身份记录。状态查询和客户端命令只提供恢复指引。
- **无法确认的旧记录：** Windows、旧前台进程、缺少可验证 worker 的 supervisor、现代身份冲突、跨执行上下文或无法读取进程信息时，需使用原版本 CLI 或服务管理器停止。只有独立确认该作用域全部运行时、supervisor、worker 和生命周期命令均已停止后，才能清理遗留元数据；不能仅因本地 PID 不存在就删除。升级前先停止仍是最简单的流程。
- **macOS 安装包：** npm 包含通用原生进程读取器，独立二进制内嵌该读取器，无需用户安装编译器或 Python。读取器不可用时拒绝自动恢复；不会通过解析扁平化的 ps 命令字符串推断身份。非常规入口或有歧义的参数可能需要人工恢复。
- **其他平台：** macOS 使用 `ps` 提供的 UTC 进程启动时间，精度为一秒；Windows 使用 PowerShell 提供的进程启动时间刻度。缺少工具、访问被拒绝、平台不受支持或执行上下文不匹配时，身份仍无法确定，操作会被拒绝。Linux 文件锁恢复机制不适用于这些平台。
- **后台容器：** supervisor 的锁已被遗弃，并不能证明其 worker 已退出。如果 worker 属于不同的 PID 命名空间，且无法确认其已退出，后台恢复仍会被阻止。手动恢复元数据前，请先停止整个旧容器，或确认整个旧容器已停止。
- **协调边界：** 此机制保护可靠锁存储上的单个作用域，并不是分布式多主机生命周期服务。请在运行时所在的执行上下文中执行停止或重启命令。身份检查发生在普通数字 PID 信号发送之前，因此检查与发送信号之间仍有很小的竞态窗口；macOS 还存在上述启动时间精度限制。PID 文件清理会重新检查记录是否属于同一次运行，但与并发写入者之间的比较和删除并不是原子操作。

### 后台启动

`1mcp serve --background` 会启动一个持久化 supervisor，并由它管理一个分离的运行时 worker；待 worker 就绪后命令返回，从而让脚本得以继续执行：

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
- **排他启动。** 若 Runtime Scope 已被占用，命令会以非零码退出，不会再派生 runtime worker 或绑定端口。多个并发启动中只能有一个成功。不同的 `--config-dir` 属于不同作用域，可独立运行。
- **崩溃恢复。** worker 每次非预期退出都会消耗一次重启尝试。supervisor 最多重试五次，延迟依次为 1、2、4、8、16 秒，并复用原始的有效配置、transport、host、port、日志与启动选项。
- **稳定后重置。** 只有替代 worker 达到就绪状态并连续存活五分钟后，重试计数才会归零。
- **健康状态仅用于观测。** 已存活的 worker 后续若无法通过就绪检查，会报告为 unreachable；不会仅因健康检查失败而被杀死或重启。
- **终止态。** 重试耗尽后，supervisor 会继续驻留，并在没有 worker 的情况下保持 `crash-loop`，直到执行 `--stop` 或 `--restart`。若初次后台启动进入该状态，原命令会以非零码退出。
- **孤儿处理。** 若 supervisor 消失而 worker 仍存活，作用域进入 `orphaned`。普通启动继续失败关闭；使用 `--stop` 或 `--restart` 进行恢复。
- **过期所有权。** 可明确判断为已死进程遗留的有效所有权可以回收；不可读、格式错误或含义不明确的所有权会失败关闭。
- **生命周期日志。** supervisor 事件会追加到后台日志，包括 worker 退出原因、尝试次数、延迟、替代 PID、恢复以及重试耗尽。

### 查看运行时状态

`1mcp serve --status` 会发现所选 Runtime Scope 中占用的运行时并报告其状态：

```bash
1mcp serve --status
1mcp serve --status --config-dir ./config
```

对于受监督的后台运行时，它会打印 supervisor 与 runtime PID、重启尝试次数、上次退出、下次重试时间、URL、启动时间、日志文件以及就绪状态：

```text
Runtime Scope: /home/me/.config/1mcp
Status: running
Supervisor PID: 48190
Runtime PID: 48213
Restart attempt: 0
Last exit: none
Next retry: none
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
- `5` —— worker 非预期退出后正在重启
- `6` —— 自动重试耗尽后处于 `crash-loop`
- `7` —— 孤儿状态（supervisor 已死，但 runtime worker 仍存活）

状态检查不会重启或杀死存活进程。能够安全确认的过期元数据会被清理；存活但 unreachable 的运行时以及含义不明确的所有权会被保留，避免错误地将作用域报告为空闲。

### 停止运行时

`1mcp serve --stop` 仅停止所选 Runtime Scope 中的运行时：

```bash
1mcp serve --stop
1mcp serve --stop --config-dir ./config
```

对于后台运行时，它会先停止 supervisor 并取消待执行的重试，再确认 worker 已退出，最后释放生命周期所有权。这个顺序可避免主动停止时又派生替代 worker。若作用域处于 orphaned，则会直接停止仍存活的 worker。

```text
Stopped supervised background runtime in Runtime Scope /home/me/.config/1mcp (supervisor PID 48190).
```

行为说明：

- **作用域隔离。** 只会向所选 Runtime Scope 记录的运行时发送信号；不同 `--config-dir` 的运行时绝不会受影响。
- **不会重新派生。** 在停止 worker 前先取消待执行的重试，并在 supervisor 与 worker 均终止后才释放所有权。
- **孤儿恢复。** supervisor 已死而 worker 仍存活时，会停止 worker 并释放其过期生命周期元数据。
- **空闲时干净处理。** 若没有运行中的运行时，会如实报告并以 `0` 退出；能够安全识别的过期元数据会一并删除。

### 重启运行时

`1mcp serve --restart` 会停止所选 Runtime Scope 中的运行时（如果有），然后启动一个全新的分离后台运行时：

```bash
1mcp serve --restart
1mcp serve --restart --config-dir ./config --port 3051
```

它由 `--stop` 与 `--background` 组合而成，因此接受与 `--background` 相同的 HTTP 选项，并打印相同的启动进度与启动报告。

行为说明：

- **始终以运行状态结束。** 遵循 `systemctl restart` 语义：对空作用域而言，先执行一次干净的空操作停止，再进行冷启动，因此一次成功的重启总会让运行时处于运行状态并以 `0` 退出。
- **重置监督状态。** `running`、`restarting`、`crash-loop` 与 `orphaned` 状态都可以重启。命令会替换 supervisor 与 worker，并重置重试计数。
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

### 启用懒加载

```bash
1mcp serve --enable-lazy-loading
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
