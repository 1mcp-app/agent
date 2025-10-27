---
title: 身份验证指南 - OAuth 2.1 设置和管理
description: 在 1MCP 中配置 OAuth 2.1 身份验证。了解如何启用身份验证、管理 OAuth 仪表板并保护您的 MCP 服务器。
head:
  - ['meta', { name: 'keywords', content: 'OAuth 2.1 身份验证,OAuth 设置,OAuth 仪表板,安全性' }]
  - ['meta', { property: 'og:title', content: '1MCP OAuth 2.1 身份验证指南' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: '为 1MCP 配置 OAuth 2.1 身份验证。使用行业标准身份验证保护您的 MCP 服务器。',
      },
    ]
---

# 身份验证

1MCP 代理使用基于 SDK 的动态方法进行 OAuth 2.1 身份验证。代理不使用静态配置文件，而是提供一组命令行标志和环境变量来配置身份验证，以及一个交互式仪表板来管理与后端服务的授权流程。

## 启用身份验证

要启用身份验证，请使用 `--enable-auth` 标志启动代理：

```bash
npx -y @1mcp/agent --config mcp.json --enable-auth
```

这将激活 OAuth 2.1 端点，并要求对所有传入请求进行身份验证。

## OAuth 管理仪表板

启用身份验证后，您可以使用 OAuth 管理仪表板来管理与后端服务的授权流程。该仪表板可在代理 URL 的 `/oauth` 端点处获得（例如，`http://localhost:3050/oauth`）。

该仪表板允许您：

- 查看所有后端服务的连接状态。
- 为需要授权的服务启动 OAuth 流程。
- 批准或拒绝授权请求。

以下是管理仪表板的预览：

![OAuth 管理仪表板](/images/auth-management.png)

当您启动授权流程时，系统将提示您批准或拒绝该请求：

![OAuth 授权应用程序](/images/oauth-authorize-application.png)

### 授权演练

1.  **导航到仪表板**：打开浏览器并转到 `http://localhost:3050/oauth`（或您的自定义 URL）。
2.  **识别待处理的服务**：查找任何状态为“等待 OAuth”的服务。
3.  **启动授权**：单击服务旁边的“授权”按钮。
4.  **授予同意**：您将被重定向到服务的授权页面。如有必要，请登录并授予所请求的权限。
5.  **在仪表板中批准**：返回 1MCP 仪表板，您将看到一个提示，要求批准连接。单击“批准”。
6.  **验证连接**：服务的状态现在应更改为“已连接”，其工具将对客户端可用。

## 基于标签的范围验证

代理支持基于标签的范围验证，允许您根据其标签控制对后端服务的访问。当客户端请求访问令牌时，它可以指定一组标签作为范围。然后，代理将只允许客户端访问具有所有请求标签的服务。

要启用基于标签的范围验证，请使用 `--enable-scope-validation` 标志：

```bash
npx -y @1mcp/agent --config mcp.json --enable-auth --enable-scope-validation
```

## 配置

有关与身份验证相关的配置选项的完整列表，请参阅[配置文档](/guide/essentials/configuration)。
