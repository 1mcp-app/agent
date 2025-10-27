---
title: Reverse Proxy Support - Deploy Behind Load Balancers
description: Configure 1MCP to work behind reverse proxies and load balancers. Set up trust proxy for nginx, Apache, and Cloudflare deployments.
head:
  - ['meta', { name: 'keywords', content: 'reverse proxy,load balancer,nginx,trust proxy,deployment' }]
  - ['meta', { property: 'og:title', content: '1MCP Reverse Proxy Support' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Deploy 1MCP behind reverse proxies and load balancers. Trust proxy configuration guide.',
      },
    ]
---

# Proxy Support

1MCP supports trust proxy configuration for deployment behind load balancers and reverse proxies like nginx, Apache, or Cloudflare.

## Overview

When 1MCP runs behind a proxy, it needs to be configured to trust the proxy in order to correctly identify the client's IP address and the protocol (HTTP/HTTPS). This is essential for security features like rate limiting and for accurate logging.

## Configuration

Trust proxy settings can be configured via the `--trust-proxy` command-line flag or the `ONE_MCP_TRUST_PROXY` environment variable.

For detailed information on the available options and how to configure them in your JSON file, CLI, or environment, please see the **[Configuration Deep Dive](/guide/essentials/configuration#network-options)**.

For specific examples and security considerations, refer to the **[Trust Proxy Reference](/reference/trust-proxy)**.
