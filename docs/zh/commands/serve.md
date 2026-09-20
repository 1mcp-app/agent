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

- **`--background`**：为所选 **Runtime Scope（运行时作用域）** 启动持久化的 Background Runtime Supervisor 及其 HTTP Aggregated Runtime，待目标运行代次完成激活后返回；后端就绪状态单独报告。仅支持 HTTP。
- **`--status`**：报告所选 **Runtime Scope（运行时作用域）** 中运行时的状态，然后退出，不启动服务器。
- **`--stop`**：停止所选 **Runtime Scope（运行时作用域）** 中的运行时，然后退出。
- **`--restart`**：使用当前调用的安装版本，协作替换所选 **Runtime Scope（运行时作用域）** 中兼容的后台 supervisor 和 worker。空作用域直接启动后台运行时。仅支持 HTTP。
- **`--drain-timeout <秒数>`**：替换提交前的可逆排空期限，默认 `30` 秒。超时会恢复旧运行时接收新工作，并中止升级。

## 运行时作用域与生命周期

**Runtime Scope（运行时作用域）** 即配置目录。运行时的唯一性以配置目录为界，而非整台机器：默认配置目录是默认的 Runtime Scope，而通过 `--config-dir` 指定的其他目录则是独立的 Runtime Scope，可运行各自的运行时。

每个 Runtime Scope 只有一个具备竞态安全保证的生命周期所有者。若该作用域已被占用，普通的前台或后台 `serve` 命令都会以非零码退出；后台运行时正在重启或处于 `crash-loop` 时也不例外。需要主动替换时应使用 `--restart`。不同配置目录之间仍相互独立。

前台 HTTP 与已弃用的前台 stdio 启动都会遵守同一所有权规则，但不会受到后台 supervisor 的监督。对于需要 stdio 兼容性的客户端，请优先使用 `1mcp proxy`；后台模式仅支持 HTTP。

### 协作式后台所有权

兼容的后台运行时通过作用域内的 supervisor 控制通道进行认证。正常的后台启动、客户端连接、状态查询、停止和协作重启，不依赖 `ps`、`sysctl` 或同类系统进程检查。supervisor 通过私有父子进程通道控制自己的 worker。持久化 PID 和作用域元数据本身不能授权发送信号或接管所有权。

此路径要求 supervisor 可响应且协议兼容，不会收养孤儿 worker 或回收身份不明确的所有权。无法连接或不兼容时会保留记录，需要通过原始 CLI 或服务管理器显式迁移或恢复。前台所有权与旧版恢复仍遵循下述进程身份规则。

### 持久卷与旧版进程身份

在 Linux 上，生命周期所有权使用内核文件锁；前台与旧版恢复还使用持久化的进程身份（系统启动 ID、PID 命名空间和进程启动时间）。系统必须提供 `flock` 命令；官方基于 Alpine 的 Docker 镜像已包含该命令。配置目录必须位于支持可靠、共享 `flock` 语义的存储上。缺少锁支持时，操作会被拒绝。

当前台 Docker 运行时被外部强制终止后，替代容器可以在同一持久卷上回收其遗留的所有权和停止操作记录，即使两个进程的 PID 都是 1。共享该卷的另一个存活容器仍持有内核锁，会阻止竞争启动。仅更改主机名不会获得接管权限。

稳定的 `runtime.owner.flock` 和 `runtime.stop.flock` 文件会在关闭后保留。文件存在不代表锁仍被持有。**只要可能还有进程使用该作用域，就不要删除这些文件**：替换它们的 inode 会破坏协调机制。

前台与旧版 `server.pid`、所有权和 supervisor 元数据会记录进程启动身份。发现和停止命令会保留身份不明确的元数据，并拒绝向未经验证的进程发送信号。停止操作在从 SIGTERM 升级到 SIGKILL 前会再次检查进程身份。

基于进程身份的 macOS 记录使用启动会话 UUID 和 UTC 进程启动时间，因此网络变化引起的主机名变化不会阻止重启。身份错误会指出具体 PID 以及缺失或不匹配的证据。请以运行时用户身份，在同一主机或容器中执行生命周期命令，并确保有读取系统进程信息的权限。若旧版主机名记录与当前主机名不一致，需要通过原始 CLI 或服务管理器执行一次经过验证的停止；下次启动会写入当前格式。不要通过删除元数据绕过验证。

旧版进程记录兼容逻辑计划在下一个主版本（1.0）移除。跨越该版本升级前请先停止旧运行时；发布说明和升级测试必须覆盖此迁移。

兼容性与限制：

- **升级仍在运行的旧后台运行时：** Linux 上，显式执行 `serve --stop` 时，可通过操作系统进程信息验证旧 supervisor 与存活 worker 的所有权声明、父子关系、用户、执行上下文和作用域，再安全停止。发送信号及清理前会重新验证，先停止 supervisor；发现 worker 或所有者已更换时中止。不会改写旧身份记录。状态查询和客户端命令只提供恢复指引。
- **人工引导的旧运行时恢复：** macOS 和 Windows、旧前台进程、缺少可验证 worker 的 supervisor、现代身份冲突、跨执行上下文或无法读取进程信息时，需使用原版本 CLI 或服务管理器停止。只有独立确认该作用域全部运行时、supervisor、worker 和生命周期命令均已停止后，才能清理遗留元数据；不能仅因本地 PID 不存在就删除。升级前先停止仍是最简单的流程。
- **其他平台的持久化身份：** macOS 身份记录使用 `ps` 提供的 UTC 进程启动时间，精度为一秒。缺少身份信息的旧记录需要人工迁移；已有有效身份记录的运行时仍按原有方式重启。Windows 身份记录使用 PowerShell 提供的进程启动时间刻度。缺少工具、访问被拒绝、平台不受支持或执行上下文不匹配时，身份仍无法确定，操作会被拒绝。Linux 文件锁恢复机制不适用于这些平台。
- **后台容器：** supervisor 的锁已被遗弃，并不能证明其 worker 已退出。如果 worker 属于不同的 PID 命名空间，且无法确认其已退出，后台恢复仍会被阻止。手动恢复元数据前，请先停止整个旧容器，或确认整个旧容器已停止。
- **协调边界：** 此机制保护可靠锁存储上的单个作用域，并不是分布式多主机生命周期服务。请在运行时所在的执行上下文中执行停止或重启命令。身份检查发生在普通数字 PID 信号发送之前，因此检查与发送信号之间仍有很小的竞态窗口；macOS 还存在上述启动时间精度限制。PID 文件清理会重新检查记录是否属于同一次运行，但与并发写入者之间的比较和删除并不是原子操作。

### 后台启动

`1mcp serve --background` 会启动一个持久化 supervisor，并由它管理一个分离的运行时 worker；待 worker 确认目标运行代次和配置已激活后返回，从而让脚本得以继续执行：

```bash
1mcp serve --background
1mcp serve --background --config-dir ./config --port 3051
```

命令会报告激活的版本、supervisor 与 worker PID、所有权代次、配置摘要、URL 和后端加载概况，然后以 `0` 退出。激活表示目标代次已取得作用域所有权、加载冻结配置并绑定入口，并不表示所有后端都已通过 `/health/ready`。

```text
Runtime activated (version <installed-version>).
Background runtime started.
Supervisor PID: 48190
Runtime PID: 48213
Generation: <claim-id>
Configuration: <configuration-digest>
URL: http://localhost:3050/mcp
Backend health: <loading-summary>
```

行为说明：

- **仅支持 HTTP。** 会拒绝 `--transport stdio`（stdio 无法分离）。`sse` 会被规整为 HTTP，运行时记录 `transport: http`。
- **激活与加载。** 启动时间由配置的加载模式决定。`--enable-async-loading` 允许先绑定 HTTP 入口，再继续加载上游服务器。后端加载失败与激活确认单独报告。
- **确定性日志。** 当未配置 `--log-file` 或 `logging.file` 时，后台日志默认写入 `<config-dir>/logs/server.log`。
- **排他启动。** 若 Runtime Scope 已被占用，命令会以非零码退出，不会再派生 runtime worker 或绑定端口。多个并发启动中只能有一个成功。不同的 `--config-dir` 属于不同作用域，可独立运行。
- **崩溃恢复。** worker 每次非预期退出都会消耗一次重启尝试。supervisor 最多重试五次，延迟依次为 1、2、4、8、16 秒，并复用原始的有效配置、transport、host、port、日志与启动选项。
- **稳定后重置。** 只有替代 worker 完成激活并连续存活五分钟后，重试计数才会归零。
- **健康状态仅用于观测。** 已存活的 worker 后续若无法通过就绪检查，会报告为 unreachable；不会仅因健康检查失败而被杀死或重启。
- **终止态。** 重试耗尽后，supervisor 会继续驻留，并在没有 worker 的情况下保持 `crash-loop`。若没有 worker 可以确认协作排空，请先执行 `--stop`，再重新启动。初次激活失败会以非零码退出。
- **孤儿处理。** 若 supervisor 消失而 worker 仍存活，会关闭新工作入口并保留所有权证据。请使用原始服务管理器或经过独立验证的恢复流程；协作重启不会根据记录中的 PID 收养孤儿或向其发送信号。
- **遗留所有权。** 协作启动要求作用域为空，绝不回收已有记录。启动前请通过显式恢复解决遗留或身份不明确的证据。

### 查看运行时状态

`1mcp serve --status` 会发现所选 Runtime Scope 中占用的运行时并报告其状态：

```bash
1mcp serve --status
1mcp serve --status --config-dir ./config
```

兼容的后台运行时通过已认证的 supervisor 查询，HTTP 就绪探测单独进行。旧版受监督运行时的报告包含 supervisor 与 runtime PID、重启尝试次数、上次退出、下次重试时间、URL、启动时间、日志文件以及就绪状态：

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

状态检查不会重启或杀死进程。协作状态查询不清理生命周期元数据。旧版发现流程仅在能独立确认记录已过期时才清理；无法连接或含义不明确的所有权仍会保留。

### 停止运行时

`1mcp serve --stop` 仅停止所选 Runtime Scope 中的运行时：

```bash
1mcp serve --stop
1mcp serve --stop --config-dir ./config
```

对于兼容的后台运行时，已认证的请求会要求 supervisor 停止自己的 worker 并取消待执行的重试。只有确认所跟踪的 worker 退出后才释放所有权。这是主动停止，不是重启使用的可逆排空。无法连接 supervisor 时需要显式恢复。

```text
Background runtime stopped.
```

行为说明：

- **作用域隔离。** 只会向所选 Runtime Scope 记录的运行时发送信号；不同 `--config-dir` 的运行时绝不会受影响。
- **不会重新派生。** 在停止 worker 前先取消待执行的重试，并在 supervisor 与 worker 均终止后才释放所有权。
- **孤儿恢复。** 协作控制无法停止不可达的 supervisor，也不会收养存活 worker。旧版恢复要求独立的身份凭证；否则请使用原始服务管理器。
- **空闲时干净处理。** 若没有运行中的运行时，会如实报告并以 `0` 退出；能够安全识别的过期元数据会一并删除。

### 重启运行时

`1mcp serve --restart` 使用执行命令的安装版本，替换兼容的后台 supervisor 与 worker：

```bash
1mcp serve --restart
1mcp serve --restart --config-dir ./config --port 3051 --drain-timeout 60
```

请先通过包管理器或二进制部署流程安装目标版本，再调用该版本的 `serve --restart`。命令不会下载或安装软件包。

行为：

- **中断前预检。** 认证旧 supervisor，确认协议能力和显式启动参数来源兼容，再由当前调用的安装版本严格校验配置。无效配置不会影响正在运行的代次。
- **冻结替换配置。** 保留显式启动设置，包括与旧默认值相同的设置；重启时显式指定的受支持选项可以覆盖它们。未指定的设置使用新版本默认值。替换进程加载已校验的快照，并在激活后恢复热重载。
- **可逆排空。** 关闭新后端工作和配置修改的入口，等待现有操作完成。新工作会收到可重试的排空错误；交互回复、进度和取消仍可继续。空闲会话不会阻止排空。
- **监听端口激活。** 协作后台启动会在后端加载完成前接收客户端，即使显式设置了 `--enable-async-loading=false`。该设置的来源与通知策略仍被保留，前台启动行为不变。后端加载状态仍通过 `/health/mcp` 展示。
- **有期限的准备。** 默认期限为 30 秒，可通过 `--drain-timeout` 设置。提交前超时会恢复旧运行时接收工作并中止替换，即使所有调用已完成或协调 CLI 已消失也如此。重复准备不会延长期限。
- **独占激活。** 提交后先退出旧 worker 和 supervisor，再由替换进程声明作用域所有权。若其他进程抢先取得所有权或旧代次未完全退出，激活会被阻止。成功报告确认新代次和配置摘要，后端健康状态单独报告。
- **允许中断。** 会话和连接可能断开；工具调用绝不自动重放。若旧运行时退出后激活失败，命令会报告失败，不会自动回滚；修复原因后重试。
- **兼容与恢复。** 不兼容或无法响应的运行时不会被协作控制强制替换。请保留记录，使用原始 CLI、服务管理器或经过独立验证的旧版恢复流程。空作用域正常启动；仍不支持 `--transport stdio`。

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
