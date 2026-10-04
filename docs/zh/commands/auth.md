---
title: Auth 命令 - 管理认证配置
description: 使用 auth 命令为受保护的 1MCP serve 实例保存、查看和删除 Bearer Token。
head:
  - ['meta', { name: 'keywords', content: '1MCP auth 命令,认证,bearer token,登录,登出' }]
  - ['meta', { property: 'og:title', content: '1MCP Auth 命令参考' }]
  - ['meta', { property: 'og:description', content: '为受保护的 1MCP serve 实例保存、查看和删除认证配置。' }]
---

# Auth 命令

管理命名 Runtime Target Context 的认证配置。

## 概要

```bash
npx -y @1mcp/agent auth <subcommand> [选项]
```

## 子命令

- **`login`** - 为 Runtime Target Context 保存 Bearer Token
- **`status`** - 查看指定 Runtime Target Context 的认证配置
- **`logout`** - 删除指定 Runtime Target Context 的认证配置
- **`export-upstream-credentials`** - 在已停止的本地 Runtime Scope 显式导出原生上游秘密

---

## auth login

保存 Bearer Token，使 `inspect`、`run` 和 `instructions` 能自动完成认证。

```bash
npx -y @1mcp/agent auth login [选项]
```

### Token 解析顺序

1. `--token` 参数（显式指定）
2. 标准输入管道（`echo $TOKEN | npx -y @1mcp/agent auth login --context <name>`）
3. 对 localhost 服务器自动生成 CLI Token（服务器支持时）

若服务器未启用认证，`login` 会提前退出并输出提示，不会保存任何 Token。

### 选项

- **`--context <name>`** - Runtime Target Context 名称。必填。
- **`--url, -u <url>`** - auth credential 命令不支持；请先使用 `target add <name> <url>`，再使用 `--context <name>`。
- **`--token, -t <token>`** - 要保存的 Bearer Token

### 示例

```bash
# 为本地运行时 Context 保存 Token
npx -y @1mcp/agent auth login --context local --token mytoken

# 从密钥管理器通过管道传入 Token
op read "op://vault/1mcp/token" | npx -y @1mcp/agent auth login --context prod

# 为命名远程 Target 保存 Token
npx -y @1mcp/agent target add prod https://1mcp.example.com
npx -y @1mcp/agent auth login --context prod --token mytoken
```

---

## auth status

查看已保存的认证配置并验证连通性。

```bash
npx -y @1mcp/agent auth status [选项]
```

`status` 需要显式指定 Runtime Target Context，并且只检查该 Context 的作用域 Token。

### 选项

- **`--context <name>`** - Runtime Target Context 名称。必填。
- **`--url, -u <url>`** - auth credential 命令不支持。

### 示例

```bash
# 查看本地运行时 Context
npx -y @1mcp/agent auth status --context local

# 查看命名远程 Target
npx -y @1mcp/agent auth status --context prod
```

---

## auth logout

删除已保存的认证配置。

```bash
npx -y @1mcp/agent auth logout [选项]
```

`logout` 需要显式指定 Runtime Target Context，并且只清除已观测运行时身份对应的 Token。

### 选项

- **`--context <name>`** - Runtime Target Context 名称。必填。
- **`--url, -u <url>`** - auth credential 命令不支持。
- **`--all`** - Runtime Target Context credential 不支持。
- **`--all-local`** - 与 `--context local` 一起使用时，不联系运行时，清除所有本地 OAuth Token 引用。

### 示例

```bash
# 删除本地运行时 Context 的配置
npx -y @1mcp/agent auth logout --context local

# 删除命名远程 Target 的配置
npx -y @1mcp/agent auth logout --context prod

# 不联系运行时，清除所有本地 OAuth Token 引用
npx -y @1mcp/agent auth logout --context local --all-local
```

---

## auth export-upstream-credentials

显式将一个本地 Runtime Scope 的上游 OAuth 秘密从系统凭据库反向迁移到明文文件。不导出入站 OAuth 或 Admin 凭据，也不使用远程 `--context`。

```bash
1mcp serve --config-dir ./config --stop
1mcp auth export-upstream-credentials --config-dir ./config
# 非交互执行时显式确认：
1mcp auth export-upstream-credentials --config-dir ./config --confirm-plaintext-export
```

命令会先显示准确的当前布局与旧布局的明文目标目录，再要求确认。请使用与运行时相同的 `--config`、`--config-dir`，以及已自定义的 `--session-storage-path`。必须验证运行时不存在；正在运行、无法访问或状态不明确时阻止导出。导出期间持有 Runtime Scope 所有权，防止新运行时启动。

每个文件目标完成持久化写入并验证后，才删除原生来源。部分失败会保留恢复引用并使命令失败；解锁凭据库、解决报告的冲突后，可重跑同一命令。重试不会覆盖较新的文件凭据。重启前设置 `[auth] credentialStore = "file"`，或使用 `--credential-store file`。导出成功覆盖当前受管理记录，不表示已擦除历史备份或文件系统残留。

---

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)** - CLI 工作流概览
- **[Instructions 命令](./instructions.md)** - 启动 CLI 工作流
- **[Inspect 命令](./inspect.md)** - 发现运行中服务器的工具
- **[Run 命令](./run.md)** - 执行工具调用
