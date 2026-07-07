# 信任代理配置

当在反向代理（如 nginx、Apache 或云负载均衡器）后面运行 1MCP 时，您需要配置其信任代理设置。这可确保代理正确识别客户端的 IP 地址，以用于日志记录、速率限制和其他安全功能。

有关如何通过命令行标志、环境变量或 JSON 配置文件设置信任代理配置的详细信息，请参阅 **[配置深入探讨](/zh/guide/essentials/configuration#network-options)**。

推荐的 Caddy 公开 HTTPS 部署路径请参阅 **[使用 Caddy 进行云端部署](/zh/guide/advanced/cloud-deployment)**。

## 信任代理选项

信任代理设置确定信任哪些传入的代理服务器。

| 值            | 描述                                                              |
| ------------- | ----------------------------------------------------------------- |
| `false`       | 禁用信任代理。连接 IP 始终被视为客户端 IP。                       |
| `true`        | 信任所有代理。客户端 IP 是 `X-Forwarded-For` 标头中最左边的条目。 |
| `loopback`    | 信任环回地址（例如 `127.0.0.1`、`::1`）。**这是默认值。**         |
| `linklocal`   | 信任链路本地地址（例如 `169.254.0.0/16`）。                       |
| `uniquelocal` | 信任专用网络地址（例如 `10.0.0.0/8`、`192.168.0.0/16`）。         |
| IP 地址       | 信任特定的 IP 地址（例如 `192.168.1.1`）。                        |
| CIDR 范围     | 信任 CIDR 表示法中的特定 IP 范围（例如 `10.0.0.0/8`）。           |

## 安全注意事项

- **默认值**：默认设置 `loopback` 对于本地开发是安全的。
- **生产**：对于生产，强烈建议为您的已知代理使用特定的 IP 地址或 CIDR 范围。
- **CDN**：仅当您位于正确设置 `X-Forwarded-For` 标头的受信任 CDN 服务（如 Cloudflare）后面时，才使用 `true`。
- **标头**：信任代理设置直接影响 `X-Forwarded-For` 标头的处理方式。

**⚠️ 重要提示**：错误配置此设置可能会产生 IP 欺骗漏洞。仅信任您控制的代理。

## 信任代理的工作原理

启用信任代理后，底层的 Express.js 服务器将：

1.  **解析 `X-Forwarded-For` 标头**以查找原始客户端 IP。
2.  **更新 `req.ip`** 以反映实际的客户端 IP，而不是代理的 IP。
3.  **填充 `req.ips`** 数组，其中包含转发链中的完整 IP 列表。
4.  **如果存在 `X-Forwarded-Proto: https` 标头，则启用安全 cookie**。

### 标头处理示例

**不使用信任代理**：

- `X-Forwarded-For: 203.0.113.1, 192.168.1.100`
- `req.ip` 将是 `192.168.1.100`（代理的 IP）
- `req.ips` 将是 `[]`

**启用信任代理**：

- `X-Forwarded-For: 203.0.113.1, 192.168.1.100`
- `req.ip` 将是 `203.0.113.1`（原始客户端的 IP）
- `req.ips` 将是 `["203.0.113.1", "192.168.1.100"]`

## 反向代理配置示例

### nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3050;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

使用此 nginx 配置，您需要将 1MCP 的信任代理设置为 `127.0.0.1`。

### Apache

```apache
<VirtualHost *:80>
    ServerName your-domain.com

    ProxyPass / http://localhost:3050/
    ProxyPassReverse / http://localhost:3050/
    ProxyPreserveHost On
    ProxyAddHeaders On
</VirtualHost>
```

使用此 Apache 配置，您还需要将 1MCP 的信任代理设置为 `127.0.0.1`。

## 故障排除

- **日志中出现错误的客户端 IP**：您的信任代理设置可能不正确。请确保它与您的代理的 IP 地址匹配。
- **IP 欺骗警告**：您的信任代理设置可能过于宽松（例如，在开放网络上使用 `true`）。
- **速率限制无法正常工作**：这通常是由于信任代理配置错误导致无法正确检测到客户端 IP 的症状。

要进行更详细的故障排除，请启用调试日志记录并检查传入请求的标头。
