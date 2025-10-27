---
title: Trust Proxy Configuration - Reverse Proxy Setup
description: Configure trust proxy settings for 1MCP behind reverse proxies. Learn about nginx, Apache, and load balancer configurations.
head:
  - ['meta', { name: 'keywords', content: 'trust proxy,reverse proxy,nginx,Apache,load balancer,IP detection' }]
  - ['meta', { property: 'og:title', content: '1MCP Trust Proxy Configuration Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Configure trust proxy for 1MCP behind reverse proxies and load balancers.',
      },
    ]
---

# Trust Proxy Configuration

When running 1MCP behind a reverse proxy (like nginx, Apache, or a cloud load balancer), you need to configure its trust proxy settings. This ensures that the agent correctly identifies the client's IP address for logging, rate limiting, and other security features.

For details on how to set the trust proxy configuration via command-line flags, environment variables, or the JSON config file, please see the **[Configuration Deep Dive](../guide/essentials/configuration#network-options)**.

## Trust Proxy Options

The trust proxy setting determines which incoming proxy servers are trusted.

| Value         | Description                                                                              |
| ------------- | ---------------------------------------------------------------------------------------- |
| `false`       | Disables trust proxy. The connecting IP is always considered the client IP.              |
| `true`        | Trusts all proxies. The client IP is the leftmost entry in the `X-Forwarded-For` header. |
| `loopback`    | Trusts loopback addresses (e.g., `127.0.0.1`, `::1`). **This is the default.**           |
| `linklocal`   | Trusts link-local addresses (e.g., `169.254.0.0/16`).                                    |
| `uniquelocal` | Trusts private network addresses (e.g., `10.0.0.0/8`, `192.168.0.0/16`).                 |
| IP Address    | Trusts a specific IP address (e.g., `192.168.1.1`).                                      |
| CIDR Range    | Trusts a specific IP range in CIDR notation (e.g., `10.0.0.0/8`).                        |

## Security Considerations

- **Default**: The default setting `loopback` is safe for local development.
- **Production**: For production, it is highly recommended to use specific IP addresses or CIDR ranges for your known proxies.
- **CDNs**: Only use `true` if you are behind a trusted CDN service like Cloudflare that properly sets the `X-Forwarded-For` header.
- **Headers**: The trust proxy setting directly affects how the `X-Forwarded-For` header is processed.

**⚠️ Important**: Incorrectly configuring this setting can create an IP spoofing vulnerability. Only trust proxies that you control.

## How Trust Proxy Works

When trust proxy is enabled, the underlying Express.js server will:

1.  **Parse `X-Forwarded-For` headers** to find the original client IP.
2.  **Update `req.ip`** to reflect the actual client IP, not the proxy's IP.
3.  **Populate the `req.ips`** array with the full list of IPs in the forwarding chain.
4.  **Enable secure cookies** if the `X-Forwarded-Proto: https` header is present.

### Example Header Processing

**Without Trust Proxy**:

- `X-Forwarded-For: 203.0.113.1, 192.168.1.100`
- `req.ip` will be `192.168.1.100` (the proxy's IP)
- `req.ips` will be `[]`

**With Trust Proxy Enabled**:

- `X-Forwarded-For: 203.0.113.1, 192.168.1.100`
- `req.ip` will be `203.0.113.1` (the original client's IP)
- `req.ips` will be `["203.0.113.1", "192.168.1.100"]`

## Reverse Proxy Configuration Examples

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

With this nginx config, you would set 1MCP's trust proxy to `127.0.0.1`.

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

With this Apache config, you would also set 1MCP's trust proxy to `127.0.0.1`.

## Troubleshooting

- **Wrong client IP in logs**: Your trust proxy setting is likely incorrect. Ensure it matches your proxy's IP address.
- **IP spoofing warnings**: Your trust proxy setting may be too permissive (e.g., using `true` on an open network).
- **Rate limiting not working correctly**: This is often a symptom of the client IP not being detected correctly due to a trust proxy misconfiguration.

For more detailed troubleshooting, enable debug logging and inspect the headers of incoming requests.
