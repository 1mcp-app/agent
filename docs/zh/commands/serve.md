# Serve 命令

使用各种传输和配置选项启动 1MCP 服务器。

## 摘要

```bash
npx -y @1mcp/agent [serve] [options]
npx -y @1mcp/agent [options]  # serve 是默认命令
```

## 描述

`serve` 命令启动 1MCP 服务器，该服务器充当多个 MCP 服务器的统一代理/多路复用器。它可以在不同的传输模式下运行，并为 MCP 客户端提供统一的接口。

有关命令行标志、环境变量和 JSON 配置选项的完整列表，请参阅 **[配置深入指南](../guide/essentials/configuration.md)**。有关 MCP 服务器配置（后端服务器、环境管理），请参阅 **[MCP 服务器参考](../reference/mcp-servers.md)**。

## 选项

serve 命令支持所有配置选项。以下是最常用的选项：

### 配置选项

- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

### 传输选项

- **`--transport, -t <type>`** - 选择传输类型（`stdio`、`http`）
- **`--port, -P <port>`** - 更改 HTTP 端口（默认：3050）
- **`--host, -H <host>`** - 更改 HTTP 主机（默认：localhost）

### 安全选项

- **`--enable-auth`** - 启用 OAuth 2.1 身份验证
- **`--enable-enhanced-security`** - 启用增强安全中间件
- **`--trust-proxy <config>`** - 信任代理配置

### 过滤选项

- **`--tag-filter, -f <expression>`** - 高级标签过滤表达式
- **`--tags, -g <tags>`** - ⚠️ 已弃用 - 请使用 `--tag-filter`

### 日志选项

- **`--log-level <level>`** - 设置日志级别（`debug`、`info`、`warn`、`error`）
- **`--log-file <path>`** - 将日志写入文件

所有选项请参见 **[配置深入指南](../guide/essentials/configuration.md)**。

## 示例

### 基本用法

```bash
# 使用默认设置启动（HTTP 在 localhost:3050）
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
npx -y @1mcp/agent serve --log-level=debug
```

### 生产部署

```bash
# 带有身份验证的生产 HTTP 服务器
npx -y @1mcp/agent serve \
  --host=0.0.0.0 \
  --port=3051 \
  --enable-auth \
  --enable-enhanced-security \
  --trust-proxy=true

# 使用外部 URL 进行 OAuth 重定向
npx -y @1mcp/agent serve \
  --external-url=https://mcp.yourdomain.com \
  --enable-auth
```

### 开发

```bash
# 使用调试日志和完整健康信息进行开发
npx -y @1mcp/agent serve \
  --log-level=debug \
  --health-info-level=full \
  --enable-async-loading

# 使用自定义配置目录进行开发
npx -y @1mcp/agent serve \
  --config-dir=./dev-config \
  --log-level=debug
```

### 标签过滤

```bash
# 简单标签过滤（OR 逻辑）- ⚠️ 已弃用
npx -y @1mcp/agent serve --transport=stdio --tags="network,filesystem"

# 高级标签过滤（布尔表达式）- 推荐
npx -y @1mcp/agent serve --transport=stdio --tag-filter="network+api"
npx -y @1mcp/agent serve --transport=stdio --tag-filter="(web,api)+prod-test"
npx -y @1mcp/agent serve --transport=stdio --tag-filter="web and api and not test"
```

> **注意：** `--tags` 参数已弃用。请使用 `--tag-filter` 进行简单和高级过滤。

## 另请参阅

- **[配置深入指南](../guide/essentials/configuration.md)** - CLI 标志和环境变量
- **[MCP 服务器参考](../reference/mcp-servers.md)** - 后端服务器配置
- **[安全指南](../reference/security.md)** - 安全最佳实践
- **[健康检查 API 参考](../reference/health-check.md)** - 监控端点
