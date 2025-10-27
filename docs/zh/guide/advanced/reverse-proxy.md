---
title: 反向代理支持 - 负载均衡器部署
description: 配置 1MCP 在反向代理和负载均衡器后面运行。为 nginx、Apache 和 Cloudflare 部署设置信任代理。
head:
  - ['meta', { name: 'keywords', content: '反向代理,负载均衡器,nginx,信任代理,部署' }]
  - ['meta', { property: 'og:title', content: '1MCP 反向代理部署指南' }]
  - ['meta', { property: 'og:description', content: '学习如何在反向代理和负载均衡器后面部署 1MCP。' }]
---

# 代理支持

1MCP 支持信任代理配置，以便在负载均衡器和反向代理（如 nginx、Apache 或 Cloudflare）后面进行部署。

## 概述

当 1MCP 在代理后面运行时，需要将其配置为信任该代理，以便正确识别客户端的 IP 地址和协议 (HTTP/HTTPS)。这对于速率限制等安全功能和准确的日志记录至关重要。

## 配置

可以通过 `--trust-proxy` 命令行标志或 `ONE_MCP_TRUST_PROXY` 环境变量来配置信任代理设置。

有关可用选项以及如何在 JSON 文件、CLI 或环境中配置它们的详细信息，请参阅 **[配置深入探讨](/guide/essentials/configuration#network-options)**。

有关具体示例和安全注意事项，请参阅 **[信任代理参考](/reference/trust-proxy)**。
