---
title: 使用 Caddy 进行云端部署
description: 在 Caddy 后面运行 1MCP，通过 HTTPS 提供 Admin Console 和本地 CLI Runtime Target 访问。
head:
  - ['meta', { name: 'keywords', content: '1MCP 云端部署,Caddy,Admin Console,Runtime Target,HTTPS' }]
  - ['meta', { property: 'og:title', content: '使用 Caddy 部署 1MCP 云端运行时' }]
  - ['meta', { property: 'og:description', content: '用 Caddy 提供公开 HTTPS，让 1mcp serve 保持在 TLS 终止之外。' }]
---

# 使用 Caddy 进行云端部署

当你要在云主机上运行一个远程 `1mcp serve`，并且需要安全的浏览器 Admin Console 与本地 CLI 访问时，使用本页。

Caddy 是第一条推荐的公开 HTTPS 反向代理路径。公开流量通过 HTTPS 到达 1MCP，`1mcp serve 不在第一版设计中终止 TLS`。Caddy 负责证书和 TLS 终止，然后把普通 HTTP 转发到 loopback 或私有网卡上的运行时。

## 部署形态

```text
浏览器或本地 CLI
  -> https://mcp.example.com
  -> Caddy TLS 终止
  -> http://127.0.0.1:3050
  -> 1mcp serve
```

如果 Caddy 与 1MCP 在同一台主机上，把 `1mcp serve` 绑定到 `127.0.0.1`。如果 Caddy 在另一台主机上，把 1MCP 绑定到私有网卡，并用安全组或防火墙限制只有代理可以访问。

## 1MCP 运行时配置

把 MCP server 定义放在 `mcp.json`：

```json
{
  "$schema": "https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json",
  "mcpServers": {}
}
```

在同级的 `config.toml` 应用配置中启用 Admin Console 和 CLI Admin Adapter：

```toml
[admin]
enabled = true
```

在 loopback 上启动运行时，并声明公开 URL 与 Caddy 信任边界：

```bash
ONE_MCP_ADMIN_USERNAME=operator \
ONE_MCP_ADMIN_PASSWORD='use-a-long-random-password' \
1mcp serve \
  --config /etc/1mcp/mcp.json \
  --host 127.0.0.1 \
  --port 3050 \
  --external-url https://mcp.example.com \
  --trust-proxy loopback \
  --enable-auth
```

`externalUrl` 必须是用户和本地 CLI 访问的公开 HTTPS origin。它用于公开 URL、Runtime Identity、OAuth 回调和安全 cookie 判断。

`trustProxy` 告诉 1MCP 哪些代理头可以代表原始协议和客户端地址。同机 Caddy 使用 `loopback`。如果 Caddy 通过私有网络访问 1MCP，使用明确的私有 CIDR，例如 `10.0.0.0/8`。除非已禁止所有绕过受信任代理的直连访问，否则不要使用 `true`。

当 `externalUrl` 是 HTTPS 时，Admin Console cookie 会带上 `Secure`。只要运行时通过受信任代理头看到原始请求是 HTTPS，浏览器 Admin Session 就能在 Caddy 后正常工作，而不需要让 `1mcp serve` 自己终止 TLS。

## Caddyfile

```caddyfile
mcp.example.com {
  encode zstd gzip

  reverse_proxy 127.0.0.1:3050
}
```

Caddy 会为公开主机名申请和续期证书。如果 1MCP 绑定到非 loopback 地址，确保公网不能直接访问 `3050` 端口。

## 暴露前先创建 Admin Account

在配置公开 DNS 或开放防火墙之前，先创建第一个 Admin Account。在运行时主机上，用与 `serve` 相同的 `--config` 或 `--config-dir` 选择本地 Runtime Scope，然后执行 bootstrap：

```bash
1mcp admin bootstrap \
  --config /etc/1mcp/mcp.json \
  --username operator \
  --password 'use-a-long-random-password'
```

无人值守启动时，只在第一次启动使用环境变量 bootstrap：

```bash
ONE_MCP_ADMIN_USERNAME=operator \
ONE_MCP_ADMIN_PASSWORD='use-a-long-random-password' \
1mcp serve --config /etc/1mcp/mcp.json --host 127.0.0.1 --port 3050
```

两种 bootstrap 路径都只会在没有任何 Admin Account 时创建第一个账号。首次启动成功后，从服务环境中移除密码。

## Admin Session 与 OAuth 的区别

Admin Session 授权与 OAuth/client-token 授权彼此独立。

Admin Session 保护 `/admin`、`/admin/api`、`/admin/cli/v1`、`1mcp admin login`，以及 `1mcp mcp enable --context prod` 这类运行时后台管理变更。Admin Session 表示操作者可以管理该运行时。

OAuth 和 client-token 授权保护 MCP 协议客户端以及 OAuth 协议端点。放在 Caddy 后面后，OAuth 协议端点保持不变。有效的 OAuth 客户端 token 不会授予 Admin Console 权限，Admin Session 也不会替代 MCP 客户端的 OAuth 授权。

## 本地 CLI Target 设置

在你的工作站上，把远程运行时加入一个命名 Runtime Target Context。URL 使用 Caddy 提供的公开 HTTPS 地址：

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp target verify prod
```

`target add` 和 `target verify` 会读取 Runtime Identity endpoint，并把本地上下文绑定到运行时的 `runtimeScopeId`。如果之后运行时报告不同身份，1MCP 会在发送 OAuth token 或 Admin Session reference 前失败关闭。

使用公开 CA 证书时不需要额外 TLS 参数。如果使用私有 CA，把 CA bundle 绑定到目标：

```bash
1mcp target add prod https://mcp.example.com/mcp --ca-file /path/to/org-ca.pem --use
1mcp target verify prod
```

生产环境避免使用 `--insecure-skip-verify`。如果必须导入或测试不安全 TLS 元数据，应保持临时状态，并在首次使用前显式确认。

身份验证通过后，为命名上下文建立 CLI Admin Session：

```bash
1mcp admin login --context prod --username operator
1mcp admin status --context prod
```

之后运行时后台管理命令就可以使用远程上下文：

```bash
1mcp mcp disable filesystem --context prod --json
1mcp mcp enable filesystem --context prod --json
```

## 暴露前检查清单

- 公开 DNS 只指向 Caddy。
- Caddy 将公开 HTTP 重定向到 HTTPS。
- `1mcp serve` 监听 `127.0.0.1` 或私有网卡，而不是公网网卡。
- `externalUrl` 是公开 HTTPS origin。
- `trustProxy` 与真实代理边界一致。
- 开放公网访问前，第一个 Admin Account 已存在。
- 本地 CLI target 使用 HTTPS，并通过 Runtime Identity 验证。
