# Serve 命令

使用各种传输和配置选项启动 1MCP 服务器。

## 摘要

```bash
npx -y @1mcp/agent [serve] [options]
npx -y @1mcp/agent [options]  # serve 是默认命令
```

## 描述

`serve` 命令启动 1MCP 服务器，该服务器充当多个 MCP 服务器的统一代理/多路复用器。它可以在不同的传输模式下运行，并为 MCP 客户端提供统一的接口。

有关命令行标志、环境变量和 JSON 配置选项的完整列表，请参阅 **[配置深入探讨](../guide/essentials/configuration.md)**

## 示例

### 基本用法

```bash
# 使用默认设置启动（HTTP 在 localhost:3051）
npx -y @1mcp/agent serve

# 在自定义端口上启动
npx -y @1mcp/agent serve --port=3052

# 使用 stdio 传输启动
npx -y @1mcp/agent serve --transport=stdio
```

### 自定义配置

```bash
# 使用自定义配置文件
npx -y @1mcp/agent serve --config=/path/to/config.json

# 使用调试日志记录启动
npx -y @1mcp/agent serve --log-level=debug --log-file=/var/log/npx -y @1mcp/agent.log
```

### 生产部署

```bash
# 带有身份验证的生产 HTTP 服务器
npx -y @1mcp/agent serve \
  --host=0.0.0.0 \
  --port=3051 \
  --auth \
  --enhanced-security \
  --trust-proxy=true

# 使用外部 URL 进行 OAuth 重定向
npx -y @1mcp/agent serve \
  --external-url=https://mcp.yourdomain.com \
  --auth
```

### 开发

```bash
# 使用调试日志记录和文件监视进行开发
npx -y @1mcp/agent serve \
  --log-level=debug \
  --health-info-level=full
```

## 另请参阅

- **[配置深入探讨](../guide/essentials/configuration)**
- **[安全指南](../reference/security)**
- **[健康检查 API 参考](../reference/health-check)**
