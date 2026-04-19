---
title: Auth 命令 - 管理认证配置
description: 使用 auth 命令为受保护的 1MCP serve 实例保存、查看和删除 Bearer Token。
head:
  - ['meta', { name: 'keywords', content: '1MCP auth 命令,认证,bearer token,登录,登出' }]
  - ['meta', { property: 'og:title', content: '1MCP Auth 命令参考' }]
  - ['meta', { property: 'og:description', content: '为受保护的 1MCP serve 实例保存、查看和删除认证配置。' }]
---

# Auth 命令

管理受保护的 1MCP `serve` 实例的认证配置。

## 概要

```bash
npx -y @1mcp/agent auth <subcommand> [选项]
```

## 子命令

- **`login`** - 为服务器 URL 保存 Bearer Token
- **`status`** - 查看已保存的认证配置
- **`logout`** - 删除已保存的认证配置

---

## auth login

保存 Bearer Token，使 `inspect`、`run` 和 `instructions` 能自动完成认证。

```bash
npx -y @1mcp/agent auth login [选项]
```

### Token 解析顺序

1. `--token` 参数（显式指定）
2. 标准输入管道（`echo $TOKEN | npx -y @1mcp/agent auth login`）
3. 对 localhost 服务器自动生成 CLI Token（服务器支持时）

若服务器未启用认证，`login` 会提前退出并输出提示，不会保存任何 Token。

### 选项

- **`--url, -u <url>`** - 1MCP 服务器 URL（省略时自动发现运行中的服务器）
- **`--token, -t <token>`** - 要保存的 Bearer Token

### 示例

```bash
# 自动发现本地服务器并通过参数保存 Token
npx -y @1mcp/agent auth login --token mytoken

# 从密钥管理器通过管道传入 Token
op read "op://vault/1mcp/token" | npx -y @1mcp/agent auth login

# 指定远程服务器
npx -y @1mcp/agent auth login --url https://1mcp.example.com --token mytoken
```

---

## auth status

查看已保存的认证配置并验证连通性。

```bash
npx -y @1mcp/agent auth status [选项]
```

省略 `--url` 时，`status` 会自动发现运行中的服务器并显示其配置。若未找到服务器，则列出所有已保存的配置。

### 选项

- **`--url, -u <url>`** - 查看指定服务器 URL 的配置

### 示例

```bash
# 查看自动发现的本地服务器
npx -y @1mcp/agent auth status

# 查看指定服务器
npx -y @1mcp/agent auth status --url https://1mcp.example.com
```

---

## auth logout

删除已保存的认证配置。

```bash
npx -y @1mcp/agent auth logout [选项]
```

未指定 `--url` 或 `--all` 时，`logout` 会自动发现运行中的服务器并删除其配置。

### 选项

- **`--url, -u <url>`** - 要删除配置的服务器 URL
- **`--all`** - 删除所有已保存的配置

### 示例

```bash
# 删除自动发现的本地服务器配置
npx -y @1mcp/agent auth logout

# 删除指定服务器的配置
npx -y @1mcp/agent auth logout --url https://1mcp.example.com

# 删除所有已保存的配置
npx -y @1mcp/agent auth logout --all
```

---

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)** - CLI 工作流概览
- **[Instructions 命令](./instructions.md)** - 启动 CLI 工作流
- **[Inspect 命令](./inspect.md)** - 发现运行中服务器的工具
- **[Run 命令](./run.md)** - 执行工具调用
