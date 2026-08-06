---
title: Admin 命令
description: 管理 Runtime Target Context 的 CLI Admin 会话。
---

# Admin 命令

`admin` 管理具名 Runtime Target Context 的 Admin 账户和 CLI Admin 会话。凭据命令需要 `--context`；Admin 凭据不支持 `--url`。

```bash
1mcp admin <subcommand> [options]
```

## bootstrap

```bash
1mcp admin bootstrap [--username <name>] [--password <password>] [--json]
```

为选定的本地 Runtime Scope 创建第一个 Admin Account。`--json` 默认值为 `false`。

## login

```bash
1mcp admin login --context <name> [--username <name>] [--password <password>] [--json]
```

为具名 context 创建 CLI Admin 会话。`--json` 默认值为 `false`。

## status

```bash
1mcp admin status --context <name> [--json]
```

显示已保存的 Admin 会话状态。`--json` 默认值为 `false`。

## logout

```bash
1mcp admin logout --context <name> [--forget] [--json]
1mcp admin logout --context local --all-local [--json]
```

撤销 CLI Admin 会话。`--forget` 仅清除本地会话引用，不确认远程撤销。`--all-local` 清除所有本地 Admin 会话引用，且必须使用 `--context local`。三个标志默认均为 `false`。

## 示例

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp admin login --context prod --username operator
1mcp admin status --context prod
```

另请参阅 [Runtime Target Context 命令](/zh/commands/target)。
