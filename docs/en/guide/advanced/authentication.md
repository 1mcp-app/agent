---
title: Authentication Guide - OAuth 2.1 Setup and Management
description: Configure OAuth 2.1 authentication in 1MCP. Learn how to enable authentication, manage the OAuth dashboard, and secure your MCP servers.
head:
  - ['meta', { name: 'keywords', content: 'OAuth 2.1 authentication,OAuth setup,OAuth dashboard,security' }]
  - ['meta', { property: 'og:title', content: '1MCP OAuth 2.1 Authentication Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Configure OAuth 2.1 authentication for 1MCP. Secure your MCP servers with industry-standard authentication.',
      },
    ]
---

# Authentication

The 1MCP Agent uses a dynamic, SDK-based approach to OAuth 2.1 authentication. Instead of a static configuration file, the agent provides a set of command-line flags and environment variables to configure authentication, and an interactive dashboard to manage the authorization flow with backend services.

## Enabling Authentication

To enable authentication, start the agent with the `--enable-auth` flag:

```bash
npx -y @1mcp/agent --config mcp.json --enable-auth
```

This will activate the OAuth 2.1 endpoints and require authentication for all incoming requests.

## OAuth Management Dashboard

Once authentication is enabled, you can use the OAuth Management Dashboard to manage the authorization flow with your backend services. The dashboard is available at the `/oauth` endpoint of your agent's URL (e.g., `http://localhost:3050/oauth`).

The dashboard allows you to:

- View the connection status of all your backend services.
- Initiate the OAuth flow for services that require authorization.
- Approve or deny authorization requests.

Here's a preview of the management dashboard:

![OAuth Management Dashboard](/images/auth-management.png)

When you initiate the authorization flow, you will be prompted to approve or deny the request:

![OAuth Authorize Application](/images/oauth-authorize-application.png)

### Authorization Walkthrough

1.  **Navigate to the Dashboard**: Open your browser and go to `http://localhost:3050/oauth` (or your custom URL).
2.  **Identify Pending Services**: Look for any services with a status of "Awaiting OAuth".
3.  **Initiate Authorization**: Click the "Authorize" button next to the service.
4.  **Grant Consent**: You will be redirected to the service's authorization page. Log in if necessary and grant the requested permissions.
5.  **Approve in Dashboard**: Back in the 1MCP dashboard, you will see a prompt to approve the connection. Click "Approve".
6.  **Verify Connection**: The service's status should now change to "Connected", and its tools will be available to clients.

## Tag-Based Scope Validation

The agent supports tag-based scope validation, which allows you to control access to backend services based on their tags. When a client requests an access token, it can specify a set of tags as scopes. The agent will then only allow the client to access services that have all the requested tags.

To enable tag-based scope validation, use the `--enable-scope-validation` flag:

```bash
npx -y @1mcp/agent --config mcp.json --enable-auth --enable-scope-validation
```

## Configuration

For a complete list of authentication-related configuration options, see the [Configuration documentation](/guide/essentials/configuration).
