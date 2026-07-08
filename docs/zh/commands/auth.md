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

### 示例

```bash
# 删除本地运行时 Context 的配置
npx -y @1mcp/agent auth logout --context local

# 删除命名远程 Target 的配置
npx -y @1mcp/agent auth logout --context prod
```

---

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)** - CLI 工作流概览
- **[Instructions 命令](./instructions.md)** - 启动 CLI 工作流
- **[Inspect 命令](./inspect.md)** - 发现运行中服务器的工具
- **[Run 命令](./run.md)** - 执行工具调用
