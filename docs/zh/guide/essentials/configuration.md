---
title: 配置指南 - CLI 标志和环境变量
description: 完整的 1MCP 配置参考。了解命令行标志、环境变量、传输选项、身份验证和运行时行为设置。
head:
  - ['meta', { name: 'keywords', content: '1MCP 配置,CLI 标志,环境变量,传输设置' }]
  - ['meta', { property: 'og:title', content: '1MCP 配置指南 - 完整参考' }]
  - ['meta', { property: 'og:description', content: '1MCP Agent 的完整配置参考。CLI 标志、环境变量和运行时设置。' }]
---

# 配置深入指南

1MCP 代理为运行时行为、传输设置、身份验证等提供了广泛的配置选项。本指南涵盖了控制代理如何运行的命令行标志和环境变量。

有关 MCP 服务器配置（后端服务器、环境管理、进程控制），请参阅 **[MCP 服务器参考](../../reference/mcp-servers.md)**。

## 配置方法

代理支持三种配置方法，按以下优先级顺序应用：

1. **环境变量**：最高优先级，适用于容器化部署
2. **命令行标志**：在运行时覆盖设置
3. **配置文件**：基础配置（在 MCP 服务器参考中介绍）

---

## 命令行选项

所有可用的命令行选项及其对应的环境变量：

| 选项 (CLI)                   | 环境变量                           | 描述                                                                     |   默认值   |
| :--------------------------- | :--------------------------------- | :----------------------------------------------------------------------- | :--------: |
| `--transport`, `-t`          | `ONE_MCP_TRANSPORT`                | 选择传输类型（"stdio"、"http" 或 "sse"）                                 |   "http"   |
| `--config`, `-c`             | `ONE_MCP_CONFIG`                   | 使用特定的配置文件                                                       |            |
| `--config-dir`, `-d`         | `ONE_MCP_CONFIG_DIR`               | 配置目录路径（覆盖默认配置位置）                                         |            |
| `--port`, `-P`               | `ONE_MCP_PORT`                     | 更改 HTTP 端口                                                           |    3050    |
| `--host`, `-H`               | `ONE_MCP_HOST`                     | 更改 HTTP 主机                                                           | localhost  |
| `--external-url`, `-u`       | `ONE_MCP_EXTERNAL_URL`             | OAuth 回调和公共 URL 的外部 URL（例如 https://example.com）              |            |
| `--trust-proxy`              | `ONE_MCP_TRUST_PROXY`              | 客户端 IP 检测的信任代理配置（布尔值、IP、CIDR、预设）                   | "loopback" |
| `--tags`, `-g`               | `ONE_MCP_TAGS`                     | 按标签过滤服务器（逗号分隔，OR 逻辑）⚠️ **已弃用 - 请使用 --tag-filter** |            |
| `--tag-filter`, `-f`         | `ONE_MCP_TAG_FILTER`               | 高级标签过滤表达式（and/or/not 逻辑）                                    |            |
| `--pagination`, `-p`         | `ONE_MCP_PAGINATION`               | 为客户端/服务器列表启用分页（布尔值）                                    |   false    |
| `--enable-auth`              | `ONE_MCP_ENABLE_AUTH`              | 启用身份验证（OAuth 2.1）                                                |   false    |
| `--enable-scope-validation`  | `ONE_MCP_ENABLE_SCOPE_VALIDATION`  | 启用基于标签的范围验证（布尔值）                                         |    true    |
| `--enable-enhanced-security` | `ONE_MCP_ENABLE_ENHANCED_SECURITY` | 启用增强安全中间件（布尔值）                                             |   false    |
| `--session-ttl`              | `ONE_MCP_SESSION_TTL`              | 会话过期时间（分钟）（数字）                                             |    1440    |
| `--session-storage-path`     | `ONE_MCP_SESSION_STORAGE_PATH`     | 自定义会话存储目录路径（字符串）                                         |            |
| `--rate-limit-window`        | `ONE_MCP_RATE_LIMIT_WINDOW`        | OAuth 速率限制窗口（分钟）（数字）                                       |     15     |
| `--rate-limit-max`           | `ONE_MCP_RATE_LIMIT_MAX`           | 每个 OAuth 速率限制窗口的最大请求数（数字）                              |    100     |
| `--enable-async-loading`     | `ONE_MCP_ENABLE_ASYNC_LOADING`     | 启用异步 MCP 服务器加载（布尔值）                                        |   false    |
| `--health-info-level`        | `ONE_MCP_HEALTH_INFO_LEVEL`        | 健康端点信息详细级别（"full"、"basic"、"minimal"）                       | "minimal"  |
| `--log-level`                | `ONE_MCP_LOG_LEVEL`                | 设置日志级别（"debug"、"info"、"warn"、"error"）                         |   "info"   |
| `--log-file`                 | `ONE_MCP_LOG_FILE`                 | 除控制台外还将日志写入文件（仅对 stdio 传输禁用控制台日志记录）          |            |
| `--help`, `-h`               |                                    | 显示帮助                                                                 |            |

---

## 配置类别

### 传输选项

控制代理与客户端和后端服务器的通信方式。

**`--transport, -t <type>`**

- **值**：`stdio`、`http`、`sse`（已弃用）
- **默认值**：`http`
- **环境变量**：`ONE_MCP_TRANSPORT`

**示例：**

```bash
# HTTP 传输（默认）
npx -y @1mcp/agent --transport http

# 用于直接 MCP 客户端集成的 Stdio 传输
npx -y @1mcp/agent --transport stdio

# 使用环境变量
ONE_MCP_TRANSPORT=stdio npx -y @1mcp/agent
```

### 网络配置

配置网络访问的 HTTP 服务器设置。

**`--port, -P <port>`**

- **默认值**：`3050`
- **环境变量**：`ONE_MCP_PORT`

**`--host, -H <host>`**

- **默认值**：`localhost`
- **环境变量**：`ONE_MCP_HOST`

**`--external-url, -u <url>`**

- **用途**：OAuth 回调和公共 URL 的外部 URL
- **环境变量**：`ONE_MCP_EXTERNAL_URL`

**示例：**

```bash
# 自定义端口和主机
npx -y @1mcp/agent --port 3051 --host 0.0.0.0

# 用于反向代理设置的外部 URL
npx -y @1mcp/agent --external-url https://mcp.example.com

# 用于 Docker 的环境变量
ONE_MCP_HOST=0.0.0.0 ONE_MCP_PORT=3051 npx -y @1mcp/agent
```

### 配置管理

控制配置文件位置和加载行为。

**`--config, -c <path>`**

- **用途**：使用特定的配置文件
- **环境变量**：`ONE_MCP_CONFIG`

**`--config-dir, -d <path>`**

- **用途**：配置目录的路径（覆盖默认位置）
- **环境变量**：`ONE_MCP_CONFIG_DIR`

**示例：**

```bash
# 使用特定的配置文件
npx -y @1mcp/agent --config ./my-config.json

# 使用自定义配置目录
npx -y @1mcp/agent --config-dir ./project-config

# 配置目录的环境变量
ONE_MCP_CONFIG_DIR=/opt/1mcp/config npx -y @1mcp/agent
```

### 安全配置

身份验证、授权和安全功能。

**`--enable-auth`**

- **用途**：启用 OAuth 2.1 身份验证
- **默认值**：`false`
- **环境变量**：`ONE_MCP_ENABLE_AUTH`

**`--enable-scope-validation`**

- **用途**：启用基于标签的范围验证
- **默认值**：`true`
- **环境变量**：`ONE_MCP_ENABLE_SCOPE_VALIDATION`

**`--enable-enhanced-security`**

- **用途**：启用增强安全中间件
- **默认值**：`false`
- **环境变量**：`ONE_MCP_ENABLE_ENHANCED_SECURITY`

**会话管理：**

- `--session-ttl <minutes>`：会话过期时间（默认：1440）
- `--session-storage-path <path>`：自定义会话存储目录
- `--rate-limit-window <minutes>`：OAuth 速率限制窗口（默认：15）
- `--rate-limit-max <requests>`：每个窗口的最大请求数（默认：100）

**示例：**

```bash
# 启用带增强安全性的身份验证
npx -y @1mcp/agent --enable-auth --enable-enhanced-security

# 自定义会话配置
npx -y @1mcp/agent \
  --enable-auth \
  --session-ttl 720 \
  --rate-limit-window 10 \
  --rate-limit-max 50

# 环境变量
ONE_MCP_ENABLE_AUTH=true \
ONE_MCP_ENABLE_ENHANCED_SECURITY=true \
npx -y @1mcp/agent
```

### 网络安全

为反向代理部署配置信任代理设置。

**`--trust-proxy <config>`**

- **默认值**：`"loopback"`
- **环境变量**：`ONE_MCP_TRUST_PROXY`
- **值**：
  - `true`：信任所有代理
  - `false`：不信任代理
  - IP 地址：信任特定 IP
  - CIDR：信任 IP 范围
  - `"loopback"`：仅信任回环地址

**示例：**

```bash
# 信任所有代理（CDN/Cloudflare）
npx -y @1mcp/agent --trust-proxy true

# 信任特定代理 IP
npx -y @1mcp/agent --trust-proxy 192.168.1.100

# 信任 IP 范围
npx -y @1mcp/agent --trust-proxy 10.0.0.0/8
```

有关详细的信任代理配置，请参阅 **[信任代理参考](../../reference/trust-proxy.md)**。

### 服务器过滤

控制加载和可用的后端 MCP 服务器。

**`--tags, -g <tags>`** ⚠️ **已弃用**

- **用途**：按标签过滤服务器（逗号分隔，OR 逻辑）
- **环境变量**：`ONE_MCP_TAGS`

**`--tag-filter, -f <expression>`** ✅ **推荐**

- **用途**：具有布尔逻辑的高级标签过滤表达式
- **环境变量**：`ONE_MCP_TAG_FILTER`

**标签过滤器语法：**

- `tag1,tag2`：OR 逻辑（任一标签）
- `tag1+tag2`：AND 逻辑（两个标签）
- `(tag1,tag2)+tag3`：复杂表达式
- `tag1 and tag2 and not tag3`：自然语言语法

**示例：**

```bash
# 简单 OR 过滤（已弃用）
npx -y @1mcp/agent --tags "network,filesystem"

# 高级过滤（推荐）
npx -y @1mcp/agent --tag-filter "network+api"
npx -y @1mcp/agent --tag-filter "(web,api)+production-test"
npx -y @1mcp/agent --tag-filter "web and api and not test"

# 环境变量
ONE_MCP_TAG_FILTER="network+api" npx -y @1mcp/agent
```

### 性能选项

控制性能和资源使用行为。

**`--enable-async-loading`**

- **用途**：启用异步 MCP 服务器加载
- **默认值**：`false`
- **环境变量**：`ONE_MCP_ENABLE_ASYNC_LOADING`

**`--pagination, -p`**

- **用途**：为客户端/服务器列表启用分页
- **默认值**：`false`
- **环境变量**：`ONE_MCP_PAGINATION`

**示例：**

```bash
# 启用异步加载以加快启动速度
npx -y @1mcp/agent --enable-async-loading

# 为大型服务器列表启用分页
npx -y @1mcp/agent --pagination

# 环境变量
ONE_MCP_ENABLE_ASYNC_LOADING=true \
ONE_MCP_PAGINATION=true \
npx -y @1mcp/agent
```

### 监控和健康

配置健康检查端点和信息详细级别。

**`--health-info-level <level>`**

- **值**：`"full"`、`"basic"`、`"minimal"`
- **默认值**：`"minimal"`
- **环境变量**：`ONE_MCP_HEALTH_INFO_LEVEL`

**级别：**

- `minimal`：仅基本健康状态
- `basic`：带基本指标的健康状态
- `full`：完整的系统信息和指标

**示例：**

```bash
# 用于监控的完整健康信息
npx -y @1mcp/agent --health-info-level full

# 基本健康信息
npx -y @1mcp/agent --health-info-level basic

# 环境变量
ONE_MCP_HEALTH_INFO_LEVEL=full npx -y @1mcp/agent
```

有关详细的健康检查信息，请参阅 **[健康检查参考](../../reference/health-check.md)**。

### 日志配置

控制日志输出、级别和目标。

**`--log-level <level>`**

- **值**：`"debug"`、`"info"`、`"warn"`、`"error"`
- **默认值**：`"info"`
- **环境变量**：`ONE_MCP_LOG_LEVEL`

**`--log-file <path>`**

- **用途**：除控制台外还将日志写入文件
- **注意**：仅对 stdio 传输禁用控制台日志记录
- **环境变量**：`ONE_MCP_LOG_FILE`

**示例：**

```bash
# 调试日志
npx -y @1mcp/agent --log-level debug

# 记录到文件
npx -y @1mcp/agent --log-file /var/log/1mcp.log

# 组合日志配置
npx -y @1mcp/agent --log-level debug --log-file app.log

# 环境变量
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent
ONE_MCP_LOG_FILE=/var/log/1mcp.log npx -y @1mcp/agent
```

**从传统 LOG_LEVEL 迁移：**
传统的 `LOG_LEVEL` 环境变量仍然受支持，但已弃用：

```bash
# ⚠️ 已弃用（显示警告）
LOG_LEVEL=debug npx -y @1mcp/agent

# ✅ 推荐
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent
# 或
npx -y @1mcp/agent --log-level debug
```

---

## 环境变量参考

所有环境变量都以 `ONE_MCP_` 为前缀，并覆盖配置文件和 CLI 设置：

- `ONE_MCP_TRANSPORT`
- `ONE_MCP_CONFIG`
- `ONE_MCP_CONFIG_DIR`
- `ONE_MCP_PORT`
- `ONE_MCP_HOST`
- `ONE_MCP_EXTERNAL_URL`
- `ONE_MCP_TRUST_PROXY`
- `ONE_MCP_TAGS`（已弃用）
- `ONE_MCP_TAG_FILTER`
- `ONE_MCP_PAGINATION`
- `ONE_MCP_ENABLE_AUTH`
- `ONE_MCP_ENABLE_SCOPE_VALIDATION`
- `ONE_MCP_ENABLE_ENHANCED_SECURITY`
- `ONE_MCP_SESSION_TTL`
- `ONE_MCP_SESSION_STORAGE_PATH`
- `ONE_MCP_RATE_LIMIT_WINDOW`
- `ONE_MCP_RATE_LIMIT_MAX`
- `ONE_MCP_ENABLE_ASYNC_LOADING`
- `ONE_MCP_HEALTH_INFO_LEVEL`
- `ONE_MCP_LOG_LEVEL`
- `ONE_MCP_LOG_FILE`

---

## 配置示例

### 开发设置

```bash
# 带调试日志和完整健康信息的开发
npx -y @1mcp/agent \
  --log-level debug \
  --health-info-level full \
  --enable-async-loading

# 用于开发的环境变量
ONE_MCP_LOG_LEVEL=debug \
ONE_MCP_HEALTH_INFO_LEVEL=full \
ONE_MCP_ENABLE_ASYNC_LOADING=true \
npx -y @1mcp/agent
```

### 生产部署

```bash
# 带身份验证的生产 HTTP 服务器
npx -y @1mcp/agent \
  --host 0.0.0.0 \
  --port 3051 \
  --enable-auth \
  --enable-enhanced-security \
  --trust-proxy true \
  --external-url https://mcp.yourdomain.com

# Docker 环境变量
docker run -p 3051:3051 \
  -e ONE_MCP_HOST=0.0.0.0 \
  -e ONE_MCP_PORT=3051 \
  -e ONE_MCP_ENABLE_AUTH=true \
  -e ONE_MCP_ENABLE_ENHANCED_SECURITY=true \
  -e ONE_MCP_TRUST_PROXY=true \
  -e ONE_MCP_EXTERNAL_URL=https://mcp.yourdomain.com \
  ghcr.io/1mcp-app/agent
```

### 过滤服务器访问

```bash
# 仅网络功能服务器
npx -y @1mcp/agent --transport stdio --tag-filter "network"

# 复杂过滤：（web 或 api）且 production，非 test
npx -y @1mcp/agent --transport stdio --tag-filter "(web,api)+production-test"

# 自然语言过滤
npx -y @1mcp/agent --transport stdio --tag-filter "api and database and not test"
```

---

## 另请参阅

- **[MCP 服务器参考](../../reference/mcp-servers.md)** - 后端服务器配置
- **[Serve 命令参考](../../commands/serve.md)** - 命令行使用示例
- **[信任代理指南](../../reference/trust-proxy.md)** - 反向代理配置
- **[健康检查参考](../../reference/health-check.md)** - 监控和健康端点
- **[安全指南](../../reference/security.md)** - 安全最佳实践
