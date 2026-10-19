---
title: Cloud Deployment with Caddy
description: Run 1MCP on a cloud host behind Caddy with HTTPS, Admin Console access, and local CLI runtime targets.
head:
  - ['meta', { name: 'keywords', content: '1MCP cloud deployment,Caddy,Admin Console,runtime target,HTTPS' }]
  - ['meta', { property: 'og:title', content: '1MCP Cloud Deployment with Caddy' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Deploy 1MCP behind Caddy for public HTTPS while keeping TLS termination out of 1mcp serve.',
      },
    ]
---

# Cloud Deployment with Caddy

Use this page when you want one remote `1mcp serve` runtime on a cloud VM and you need secure browser Admin Console plus local CLI access to that runtime.

Caddy is the first blessed reverse-proxy example for public HTTPS. In this design, public traffic reaches 1MCP through HTTPS, and `1mcp serve does not terminate TLS` in the first design. Caddy owns certificates and forwards plain HTTP to the runtime on loopback or a private network interface.

## Deployment Shape

```text
Browser or local CLI
  -> https://mcp.example.com
  -> Caddy TLS termination
  -> http://127.0.0.1:3050
  -> 1mcp serve
```

Bind `1mcp serve` to `127.0.0.1` when Caddy runs on the same host. If Caddy runs on a separate host, bind 1MCP to a private interface and restrict the security group or firewall so only the proxy can reach it.

## 1MCP Runtime Configuration

Keep MCP server definitions in `mcp.json`:

```json
{
  "$schema": "https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json",
  "mcpServers": {}
}
```

Enable the Admin Console and CLI Admin Adapter in the sibling `config.toml` application config:

```toml
[admin]
enabled = true
```

Start the runtime on loopback with the public URL and Caddy trust boundary:

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

`externalUrl` must be the public HTTPS origin that users and local CLIs use. It is used for public URLs, Runtime Identity, OAuth callbacks, and secure-cookie decisions.

`trustProxy` tells 1MCP which proxy headers to trust for the original scheme and client address. Use `loopback` for same-host Caddy. Use a specific private CIDR, such as `10.0.0.0/8`, when Caddy reaches 1MCP over a private network. Do not use `true` unless all direct runtime access is blocked except through trusted proxies.

When `externalUrl` is HTTPS, Admin Console cookies are marked `Secure`. If the runtime sees the request as HTTPS through trusted proxy headers, browser Admin Sessions work behind Caddy without making `1mcp serve` terminate TLS.

## Caddyfile

```caddyfile
mcp.example.com {
  encode zstd gzip

  reverse_proxy 127.0.0.1:3050
}
```

Caddy obtains and renews certificates for the public hostname. Keep port `3050` closed to the public internet when 1MCP is bound to anything other than loopback.

## Bootstrap Admin Before Exposure

Create the first Admin Account before exposing the runtime through public DNS or opening firewall rules. On the runtime host, bootstrap the local Runtime Scope selected by the same `--config` or `--config-dir` you use for `serve`:

```bash
1mcp admin bootstrap \
  --config /etc/1mcp/mcp.json \
  --username operator \
  --password 'use-a-long-random-password'
```

For headless startup, use environment bootstrap on the first boot only:

```bash
ONE_MCP_ADMIN_USERNAME=operator \
ONE_MCP_ADMIN_PASSWORD='use-a-long-random-password' \
1mcp serve --config /etc/1mcp/mcp.json --host 127.0.0.1 --port 3050
```

Both bootstrap paths create the first account only when no Admin Account exists. Remove the password from service environment after the first successful start.

## Admin Session vs OAuth

Admin Session authorization is separate from OAuth/client-token authorization.

Admin Sessions protect `/admin`, `/admin/api`, `/admin/cli/v1`, `1mcp admin login`, and runtime-backed admin mutations such as `1mcp mcp enable --context prod`. An Admin Session proves that an operator can administer the runtime.

OAuth and client-token authorization protect MCP protocol clients and OAuth protocol endpoints. The OAuth protocol endpoints remain unchanged behind Caddy. A valid OAuth client token does not grant Admin Console access, and an Admin Session does not replace client OAuth consent for MCP clients.

## Local CLI Target Setup

On your workstation, add the remote runtime as a named Runtime Target Context. Use the public HTTPS URL that Caddy serves:

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp target verify prod
```

`target add` and `target verify` read the Runtime Identity endpoint and bind the local context to the runtime's `runtimeScopeId`. If the runtime later reports a different identity, 1MCP fails closed before sending OAuth tokens or Admin Session references.

For public CA certificates, no extra TLS trust flag is needed. For a private CA, attach the CA bundle to the target:

```bash
1mcp target add prod https://mcp.example.com/mcp --ca-file /path/to/org-ca.pem --use
1mcp target verify prod
```

Avoid `--insecure-skip-verify` for production. If you must import or test insecure TLS metadata, keep it temporary and confirm it explicitly before first use.

After identity verification, establish a CLI Admin Session for the named context:

```bash
1mcp admin login --context prod --username operator
1mcp admin status --context prod
```

Runtime-backed admin commands can now use the remote context:

```bash
1mcp mcp disable filesystem --context prod --json
1mcp mcp enable filesystem --context prod --json
```

## Exposure Checklist

- Public DNS points only at Caddy.
- Public HTTP is redirected to HTTPS by Caddy.
- `1mcp serve` listens on `127.0.0.1` or a private interface, not a public interface.
- `externalUrl` is the public HTTPS origin.
- `trustProxy` matches the actual proxy boundary.
- The first Admin Account exists before opening public access.
- Local CLI targets use HTTPS and pass Runtime Identity verification.
