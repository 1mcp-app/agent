# mcp restart

重启由正在运行的 1MCP 聚合运行时负责管理的后端。

## 摘要

```bash
npx -y @1mcp/agent mcp restart <name> [options]
```

## 参数

- **`<name>`** - 静态服务器或模板后端的名称。必需。

## 后端选择器

- 不指定后端选择器时，命令会重启静态服务器。对于模板，命令会重启全部异常活动实例。`backend_no_active_instances` 表示模板当前没有活动实例；`backend_no_unhealthy_instances` 表示所有活动实例均健康，因此默认策略不会执行重启。
- 对已禁用的静态目标执行重启会返回 `backend_disabled`；请先启用该目标。
- **`--instance <id-or-prefix>`** - 通过完整的 64 位实例 ID 或无歧义前缀重启一个活动模板实例。状态输出使用前 12 位作为短显示 ID。若前缀对应多个实例，命令会拒绝执行并报告候选实例。
- **`--all-instances`** - 重启指定模板的全部活动实例。

`--instance` 与 `--all-instances` 不能同时使用。

## 运行时目标选项

- **`--context <name>`** - 选择已配置的运行时目标上下文（Runtime Target Context）。省略时使用当前上下文。
- **`--idempotency-key <key>`** - 重试同一操作时复用稳定的幂等键。
- **`--wait-ms <milliseconds>`** - 等待操作完成的最长时间。默认为 `5000`。
- **`--confirm-non-loopback`** - 确认对非 loopback 运行时目标执行变更。
- **`--json`** - 输出机器可读的结果。

这是运行时支持的操作，不会修改配置文件。所选运行时必须声明 `mcp.restart` 管理能力，且运行时目标上下文必须具有已认证的 Admin Session。临时 `--url` 不能用于这类需凭据的变更；请先添加或选择运行时目标上下文。

主动重启会清零后端的自动重启尝试计数，并立即开始恢复。它与自动监督使用同一套全新连接生命周期：当前后端先变为不可用并撤回能力与 instructions，然后创建新的进程、传输和 MCP 客户端连接；替代连接完成初始化后才恢复可用状态。

## 示例

```bash
# 在当前运行时目标上下文中重启静态后端
npx -y @1mcp/agent mcp restart filesystem

# 使用无歧义的 ID 前缀重启一个模板实例
npx -y @1mcp/agent mcp restart github --instance 6f44b6a1c2d3

# 重启模板的全部活动实例
npx -y @1mcp/agent mcp restart github --all-instances

# 选择另一个运行时目标上下文并输出 JSON
npx -y @1mcp/agent mcp restart filesystem --context staging --json
```

## 另请参阅

- **[MCP 服务器配置参考](/zh/reference/mcp-servers)** - 配置 stdio 自动监督
- **[mcp status](/zh/commands/mcp/status)** - 查看后端运行时状态和监督信息
