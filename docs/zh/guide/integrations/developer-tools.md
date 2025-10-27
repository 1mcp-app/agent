---
title: 开发者与集成 - API 与工具
description: 1MCP 开发者友好的 RESTful API 和标准合规性。无缝集成、开发工具和扩展性。
head:
  - ['meta', { name: 'keywords', content: '开发者工具,API 集成,RESTful API,MCP 协议,开发者友好' }]
  - ['meta', { property: 'og:title', content: '1MCP 开发者与集成指南' }]
  - ['meta', { property: 'og:description', content: '1MCP 开发者友好的 API 和集成工具指南。' }]
---

# 开发者与集成

> **🔧 开发者友好**：干净的 API、标准合规性和工具，实现无缝集成和开发

## 🔌 RESTful API 与标准合规

**功能描述**：干净的 REST API，完全兼容 MCP 协议
**适用场景**：与任何客户端轻松集成，保持 MCP 标准合规性
**优势特点**：文档完善的端点、标准 HTTP 方法、一致的响应

**API 示例**：

```bash
# MCP 协议端点
POST /mcp
Content-Type: application/json
Authorization: Bearer {token}

# OAuth 管理仪表板
GET /oauth

# OAuth 端点（启用身份验证时）
POST /oauth/token
GET /oauth/callback/:serverName
```

**⏱️ 设置时间**：立即可用
**🎯 适用场景**：自定义集成、API 客户端、第三方工具
**✅ 获得收益**：标准 REST API、MCP 合规性、全面文档

---

## 📡 HTTP 传输与 MCP 协议

**功能描述**：使用 MCP 协议标准的基于 HTTP 的可靠通信
**适用场景**：AI 客户端和 MCP 服务器之间的标准合规通信
**优势特点**：请求/响应模式、适当的错误处理、协议合规性

**HTTP MCP 示例**：

```bash
# 基于 HTTP 的 MCP 协议
POST /mcp
Content-Type: application/json
Authorization: Bearer {token}

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**⏱️ 设置时间**：内置，默认传输
**🎯 适用场景**：标准 MCP 客户端集成、可靠通信
**✅ 获得收益**：MCP 协议合规性、可靠传输、标准 HTTP 方法

**注意**：SSE 传输已弃用 - 请改用 HTTP 传输

---

## 🧪 开发与集成支持

**功能描述**：提供用于测试和集成的开发者友好功能
**适用场景**：更轻松的开发、调试和集成测试
**优势特点**：热重载配置、结构化日志、MCP Inspector 支持

**开发功能**：

```bash
# 热重载配置更改
npx -y @1mcp/agent --config dev.json
# 编辑 dev.json → 自动应用更改

# 使用 MCP Inspector 进行测试
npx @modelcontextprotocol/inspector
# 连接到 http://localhost:3050 进行交互式测试

# 环境特定日志
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent --config dev.json

# 多环境配置
npx -y @1mcp/agent --config dev.json --port 3051
npx -y @1mcp/agent --config staging.json --port 3052
```

**⏱️ 设置时间**：内置开发功能
**🎯 适用场景**：开发工作流、测试、调试集成问题
**✅ 获得收益**：热重载配置、MCP Inspector 集成、结构化日志、多环境支持

---

## 开发工作流

### 集成测试

- **MCP Inspector**：用于调试的交互式测试界面
- **健康端点**：系统状态的自动化测试
- **请求/响应日志**：详细的调试信息
- **多环境**：开发/测试/生产的单独配置

### API 集成

- **标准 REST**：与任何 HTTP 客户端轻松集成
- **错误处理**：一致的错误响应和代码
- **身份验证**：用于安全 API 访问的 OAuth 2.1

### 调试和故障排除

- **结构化日志**：基于 Winston 的分级日志
- **请求跟踪**：跟踪通过系统的请求
- **健康诊断**：详细的系统和服务器状态
- **配置验证**：配置问题的早期检测

### 客户端库

- **HTTP 客户端**：使用任何 HTTP 库（fetch、axios、curl）
- **MCP 库**：官方 MCP 客户端库
- **实时通知**：支持从服务器接收实时更新（例如，`listChanged` 通知）。
- **自定义集成**：构建您自己的客户端实现

### 开发最佳实践

#### 配置管理

- **环境分离**：每个环境的不同配置
- **密钥管理**：安全处理敏感数据
- **热重载**：快速开发迭代周期
- **验证**：配置错误的早期检测

#### 测试策略

- **单元测试**：测试单个组件和函数
- **集成测试**：测试服务器交互和工作流
- **端到端测试**：使用真实 MCP 服务器的完整系统测试
- **负载测试**：现实条件下的性能测试

#### 监控和可观测性

- **请求日志**：跟踪所有 API 请求和响应
- **性能指标**：监控响应时间和吞吐量
- **错误跟踪**：集中错误收集和分析
- **健康监控**：持续系统健康验证

### 下一步

- **核心设置** → [核心功能](/guide/essentials/core-features)
- **安全集成** → [安全功能](/guide/advanced/security)
- **生产部署** → [企业功能](/guide/advanced/enterprise)

### 集成指南

- **身份验证设置** → [身份验证指南](/guide/advanced/authentication)
- **配置参考** → [配置指南](/guide/essentials/configuration)
- **API 文档** → [API 参考](/reference/health-check)

---

> **🔧 开发者提示**：这些功能旨在使集成和开发尽可能顺畅。从 MCP Inspector 的交互式测试开始，然后使用标准 HTTP API 构建您的集成。
