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

有关可用选项以及如何在 JSON 文件、CLI 或环境中配置它们的详细信息，请参阅 **[配置深入探讨](/zh/guide/essentials/configuration#network-options)**。

如果需要使用 Caddy 完成云端 Admin Console 与本地 CLI target 工作流，请参阅 **[使用 Caddy 进行云端部署](/zh/guide/advanced/cloud-deployment)**。

有关具体示例和安全注意事项，请参阅 **[信任代理参考](/zh/reference/trust-proxy)**。

## 客户端身份与限流

Admin 与健康检查限流器使用 Express 解析后的 `req.ip`；1MCP 不会自行解析转发头。只信任真实存在的代理跳数。边界正确时，不同的转发客户端会使用不同限流键；未信任代理时，请求会合并到代理地址；过度信任则允许调用方选择表面客户端 IP，绕过进程内限制。

修改信任代理边界或 Admin/健康检查策略后必须重启聚合运行时。这些本地限流器不会在多个副本间同步计数，因此反向代理或负载均衡器上的边缘限流仍应保持启用。
