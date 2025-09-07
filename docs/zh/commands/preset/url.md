# preset url

为预设生成客户端 URL。

有关预设管理的完整概述，请参阅 **[预设命令概述](./index)**。

## 概要

```bash
npx -y @1mcp/agent preset url <name>
```

## 参数

- **`<name>`**
  - 要为其生成 URL 的预设名称。
  - **必需**：是

## 描述

`preset url` 命令为特定预设生成客户端 URL。此 URL 可以直接在 MCP 客户端配置中使用，以访问由预设定义的过滤服务器子集。

### URL 格式

```
http://host:port/?preset=name
```

- **host:port**：您的 1MCP 服务器地址（默认：`127.0.0.1:3050`）
- **preset=name**：激活预设的查询参数

## 示例

### 基本用法

```bash
# 为开发预设生成 URL
npx -y @1mcp/agent preset url development
# Output: http://127.0.0.1:3050/?preset=development

# 为生产预设生成 URL
npx -y @1mcp/agent preset url production
# Output: http://127.0.0.1:3050/?preset=production
```

### 与客户端配置的集成

#### Claude Desktop

```json
{
  "mcpServers": {
    "1mcp-development": {
      "command": "npx",
      "args": ["-y", "@1mcp/agent", "serve"],
      "env": {
        "ONE_MCP_PRESET_URL": "http://127.0.0.1:3050/?preset=development"
      }
    }
  }
}
```

#### Cursor/VS Code

```json
{
  "mcp.servers": {
    "1mcp-production": {
      "url": "http://127.0.0.1:3050/?preset=production"
    }
  }
}
```

## 用例

### 开发环境设置

```bash
# 获取开发预设 URL
DEV_URL=$(npx -y @1mcp/agent preset url development)
echo "Configure your development client with: $DEV_URL"
```

### 团队配置共享

```bash
# 与团队成员共享预设 URL
echo "Development: $(npx -y @1mcp/agent preset url team-dev)"
echo "Staging: $(npx -y @1mcp/agent preset url team-staging)"
echo "Production: $(npx -y @1mcp/agent preset url team-prod)"
```

### 自动化脚本

```bash
#!/bin/bash
# 使用当前预设 URL 更新客户端配置

DEV_URL=$(npx -y @1mcp/agent preset url development)
PROD_URL=$(npx -y @1mcp/agent preset url production)

# 更新配置文件
sed -i "s|preset=development|${DEV_URL}|g" config/dev.json
sed -i "s|preset=production|${PROD_URL}|g" config/prod.json
```

## 动态服务器选择

当客户端使用预设 URL 时：

1. **请求处理**：1MCP 服务器接收带有 `?preset=name` 的请求
2. **预设解析**：服务器查找预设配置
3. **服务器过滤**：将预设的标签查询应用于可用服务器
4. **动态响应**：仅将匹配的服务器返回给客户端
5. **回退**：如果未找到预设，则返回所有服务器（安全默认）

### 上下文切换

客户端可以通过更改预设参数切换服务器上下文：

```bash
# 开发上下文
http://127.0.0.1:3050/?preset=development

# 生产上下文
http://127.0.0.1:3050/?preset=production

# 所有服务器（无过滤）
http://127.0.0.1:3050/
```

## 错误处理

### 预设未找到

```bash
npx -y @1mcp/agent preset url nonexistent
# Error: Preset 'nonexistent' not found
```

### 服务器配置问题

如果服务器配置有问题，URL 仍然生成，但可能无法按预期工作。使用 `preset test <name>` 验证服务器匹配。

## URL 验证

生成的 URL 经过验证以确保：

- **预设存在**：命名的预设在您的配置中
- **有效格式**：URL 遵循正确的 HTTP 格式
- **服务器可访问性**：基于当前服务器配置

## 工作流程集成

常见用法模式：

```bash
# 1. 创建或验证预设存在
npx -y @1mcp/agent preset list

# 2. 为客户端配置生成 URL
npx -y @1mcp/agent preset url development

# 3. 测试预设以验证服务器匹配
npx -y @1mcp/agent preset test development

# 4. 使用生成的 URL 配置您的 MCP 客户端
```

## 高级用法

### 自定义服务器配置

如果您的 1MCP 服务器在不同的主机/端口上运行：

```bash
# URL 将反映您服务器的实际配置
# 例如，如果在端口 3052 上运行：
npx -y @1mcp/agent preset url development
# Output: http://127.0.0.1:3052/?preset=development
```

### 多环境

```bash
# 为不同环境生成 URL
for env in development staging production; do
  echo "$env: $(npx -y @1mcp/agent preset url $env)"
done
```

## 另请参阅

- **[preset show](./show)** - 显示完整的预设详细信息，包括 URL
- **[preset test](./test)** - 测试预设服务器匹配
- **[preset create](./create)** - 创建新预设以生成 URL
- **[preset list](./list)** - 列出所有可用的预设
