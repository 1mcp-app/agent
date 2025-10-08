# Proxy 命令

启动 STDIO 代理，将仅支持 STDIO 传输的 MCP 客户端连接到运行中的 1MCP HTTP 服务器。

## 概要

```bash
npx -y @1mcp/agent proxy [选项]
```

## 描述

`proxy` 命令创建一个 STDIO 传输代理，将所有 MCP 协议通信转发到运行中的 1MCP HTTP 服务器。这使得仅支持 STDIO 传输的 MCP 客户端（如 Claude Desktop）能够连接到具有身份验证、过滤和多客户端支持等高级功能的集中式 1MCP HTTP 服务器。

代理使用多种方法自动发现运行中的 1MCP 服务器，并在支持标签过滤和预设配置的同时，为 STDIO 和 HTTP 传输提供无缝桥接。

## 自动发现

代理按以下顺序自动发现运行中的 1MCP 服务器：

1. **PID 文件** - 从 `~/.config/1mcp/server.pid` 读取服务器 URL
2. **端口扫描** - 在本地主机上扫描常用端口（3050、3051、3052）
3. **环境变量** - 使用 `ONE_MCP_HOST` 和 `ONE_MCP_PORT`
4. **用户覆盖** - 使用 `--url` 选项指定的 URL

## 项目配置（.1mcprc）

您可以在项目目录中创建名为 `.1mcprc` 的项目级配置文件，为代理命令设置默认连接设置。这允许您避免重复命令行选项，并在团队成员之间共享配置。

### 先决条件

**项目配置专门为满足以下条件的 MCP 客户端设计：**

- **不支持** HTTP 或 SSE（Server-Sent Events）传输
- **仅支持** STDIO 传输（如 Claude Desktop）
- **需要通过代理**连接到运行中的 1MCP HTTP 服务器

**必需设置：**

1. **运行中的 1MCP 服务器**：必须在某个端口上运行 `npx -y @1mcp/agent serve`
2. **MCP 客户端限制**：客户端无法直接连接到 HTTP/SSE 端点
3. **桥接需求**：需要代理来转换 STDIO ↔ HTTP 通信

对于可以直接连接到 HTTP/SSE 端点的 MCP 客户端，**不需要**此配置。

### 配置优先级

设置按以下顺序加载（高优先级覆盖低优先级）：

1. **命令行选项**（最高优先级）
2. **项目配置文件**（`.1mcprc`）
3. **默认值**（最低优先级）

### 配置结构

在项目目录中创建 `.1mcprc` 文件：

```json
{
  // 1MCP 代理命令的项目级配置
  // 使用预设进行团队协作和配置管理

  "preset": "my-preset"
}
```

### 推荐方法

我们建议使用预设以获得更好的配置管理和团队协作：

1. **创建预设**用于不同环境（开发、生产、测试）
2. **与团队成员共享预设**以获得一致的配置
3. **轻松切换环境**，只需更改预设名称

### 配置示例

#### 开发环境

```json
{
  "preset": "dev-environment"
}
```

#### 生产环境设置

```json
{
  "preset": "production"
}
```

#### 测试环境

```json
{
  "preset": "testing"
}
```

从项目根目录复制 `.1mcprc.example` 文件作为起始模板。

## 选项

### 连接选项

- **`--url, -u <url>`** - 覆盖自动发现的 1MCP 服务器 URL
- **`--timeout, -t <ms>`** - 连接超时时间（毫秒，默认：10000）

### 过滤选项

- **`--filter, -f <表达式>`** - 服务器选择的过滤表达式
- **`--preset, -P <名称>`** - 加载预设配置（URL、过滤器等）

### 全局选项

- **`--config-dir, -d <路径>`** - 用于发现的配置目录路径
- **`--log-level <级别>`** - 设置日志级别（`debug`、`info`、`warn`、`error`）
- **`--log-file <路径>`** - 将日志写入文件

## 标签过滤

使用 `--filter` 选项限制通过代理暴露哪些 MCP 服务器：

### 简单过滤（OR 逻辑）

```bash
--filter "web,api,database"  # 暴露具有这些标签中任意一个的服务器
```

### 高级过滤（布尔表达式）

```bash
--filter "web AND database"           # 同时具有两个标签的服务器
--filter "(web OR api) AND database"  # 复杂逻辑
--filter "web AND NOT test"           # 排除逻辑
```

### 优先级顺序

1. `--filter` 选项（最高优先级）
2. 预设标签查询（如果指定了 `--preset`）
3. `.1mcprc` 配置文件（仅预设）
4. 无过滤（暴露所有服务器）

## 示例

### 基本用法

```bash
# 自动发现并连接到运行中的 1MCP 服务器
npx -y @1mcp/agent proxy

# 使用调试日志连接
npx -y @1mcp/agent proxy --log-level=debug

# 使用自定义配置目录进行发现
npx -y @1mcp/agent proxy --config-dir=./test-config

# 使用项目配置文件（.1mcprc）
npx -y @1mcp/agent proxy
```

### 特定服务器连接

```bash
# 连接到特定的服务器 URL
npx -y @1mcp/agent proxy --url http://localhost:3051/mcp

# 使用自定义超时时间连接
npx -y @1mcp/agent proxy --url http://192.168.1.100:3051/mcp --timeout=5000
```

### 标签过滤

```bash
# 仅暴露具有 web 和 api 标签的服务器
npx -y @1mcp/agent proxy --filter "web AND api"

# 暴露开发服务器
npx -y @1mcp/agent proxy --filter "dev OR test"

# 复杂过滤逻辑
npx -y @1mcp/agent proxy --filter "(web OR mobile) AND NOT production"
```

### 预设集成

```bash
# 从保存的预设加载 URL 和过滤器
npx -y @1mcp/agent proxy --preset my-dev-setup

# 使用预设和自定义配置目录
npx -y @1mcp/agent proxy --preset production --config-dir ./prod-config
```

### 开发和测试

```bash
# 完整日志记录的开发模式
npx -y @1mcp/agent proxy \
  --log-level=debug \
  --log-file=proxy-debug.log \
  --config-dir=./dev-config

# 测试特定服务器和过滤
npx -y @1mcp/agent proxy \
  --url http://localhost:3051/mcp \
  --filter "filesystem,editing" \
  --timeout=15000

# 在开发中使用项目配置
# 创建包含开发预设的 .1mcprc 文件
echo '{"preset": "dev-setup"}' > .1mcprc
npx -y @1mcp/agent proxy
```

## 身份验证注意事项

### STDIO 传输限制

- STDIO 传输**不**支持 OAuth 2.1 身份验证
- STDIO 客户端无法向启用身份验证的服务器进行身份验证

### 推荐设置

#### 对于 STDIO 客户端（Claude Desktop 等）

```bash
# 为 STDIO 客户端启动无身份验证的服务器
npx -y @1mcp/agent serve --port=3051

# 启动代理（开箱即用）
npx -y @1mcp/agent proxy
```

#### 对于 HTTP/SSE 客户端

```bash
# 为 Web 客户端启动带身份验证的服务器
npx -y @1mcp/agent serve --port=3052 --enable-auth

# HTTP/SSE 客户端可以通过 OAuth 进行身份验证
curl "http://localhost:3052/mcp?app=cursor"
```

### 混合环境策略

为不同客户端类型运行独立的服务器实例：

- **端口 3051**：STDIO 客户端无身份验证（通过代理）
- **端口 3052**：HTTP/SSE 客户端有身份验证

## 工作流集成

### 典型开发工作流

1. **启动 1MCP 服务器**

   ```bash
   npx -y @1mcp/agent serve --port=3051
   ```

2. **添加 MCP 服务器**

   ```bash
   npx -y @1mcp/agent mcp add filesystem -- npx mcp-server-filesystem
   npx -y @1mcp/agent mcp add github -- npx mcp-server-github
   ```

3. **创建预设（可选）**

   ```bash
   npx -y @1mcp/agent preset create dev --filter "filesystem,github"
   ```

4. **启动代理**

   ```bash
   npx -y @1mcp/agent proxy --preset dev
   ```

5. **配置客户端**
   - 将 Claude Desktop 指向代理命令
   - 客户端通过 STDIO 与代理通信
   - 代理将请求转发到带过滤的 HTTP 服务器

### 生产部署

```bash
# 带过滤的生产服务器
npx -y @1mcp/agent serve \
  --port=3051 \
  --enable-enhanced-security

# 带预设的生产代理
npx -y @1mcp/agent proxy \
  --preset production \
  --log-level=info \
  --config-dir /etc/1mcp
```

## 故障排除

### 常见问题

#### 未找到服务器

```bash
# 检查服务器是否正在运行
npx -y @1mcp/agent mcp status

# 手动验证服务器 URL
curl http://localhost:3051/mcp
```

#### 连接超时

```bash
# 为慢速服务器增加超时时间
npx -y @1mcp/agent proxy --timeout=30000

# 检查网络连接
netstat -an | grep 3051
```

#### 过滤器不工作

```bash
# 使用调试日志查看过滤详情
npx -y @1mcp/agent proxy --filter "web" --log-level=debug

# 验证服务器标签
npx -y @1mcp/agent mcp list --tags=web
```

### 调试信息

启用调试日志来排查问题：

```bash
npx -y @1mcp/agent proxy --log-level=debug
```

调试输出显示：

- 服务器发现尝试
- 连接建立详情
- 标签解析和过滤逻辑
- MCP 协议转发

## 另请参阅

- **[Serve 命令](./serve.md)** - 启动 1MCP 服务器
- **[MCP 命令](./mcp/)** - 管理 MCP 服务器配置
- **[预设命令](./preset/)** - 创建和管理预设
- **[配置指南](../guide/essentials/configuration.md)** - 配置选项
- **[Claude Desktop 集成](../guide/integrations/claude-desktop.md)** - 桌面客户端设置
- **[架构参考](../reference/architecture.md)** - 传输层详情
