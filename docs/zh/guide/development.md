---
title: 开发指南 - 构建和贡献
description: 为 1MCP Agent 设置开发环境。了解如何从源码构建、运行测试并为项目做出贡献。
head:
  - ['meta', { name: 'keywords', content: '1MCP 开发,从源码构建,贡献,开发环境' }]
  - ['meta', { property: 'og:title', content: '1MCP 开发指南' }]
  - ['meta', { property: 'og:description', content: '1MCP Agent 的开发指南。从源码构建和贡献。' }]
---

# 开发

本指南介绍如何为 1MCP Agent 设置开发环境、从源码构建以及为项目做出贡献。

## 先决条件

- [Node.js](https://nodejs.org/)（版本 21 或更高）
- [pnpm](https://pnpm.io/) 包管理器
- Git

## 从源码安装

1. **克隆仓库**

   ```bash
   git clone https://github.com/1mcp-app/agent.git
   cd agent
   ```

2. **安装依赖**

   ```bash
   pnpm install
   ```

3. **构建项目**

   ```bash
   pnpm build
   ```

4. **运行开发服务器**

   ```bash
   # 首先复制示例环境文件
   cp .env.example .env

   # 然后运行开发服务器
   pnpm dev
   ```

## 开发工作流

### 可用脚本

```bash
# 开发模式，自动重建和测试配置
pnpm dev

# 构建项目
pnpm build

# 开发监视模式
pnpm watch

# 代码检查
pnpm lint
pnpm lint:fix

# 类型检查
pnpm typecheck

# 测试
pnpm test:unit
pnpm test:unit:watch
pnpm test:unit:coverage
pnpm test:e2e
pnpm test:e2e:watch
pnpm test:e2e:coverage

# 使用 MCP Inspector 调试
pnpm inspector

# 其他实用工具
pnpm clean         # 清理构建产物
pnpm format        # 使用 Prettier 格式化代码
pnpm format:check  # 检查代码格式

# 二进制文件和打包
pnpm sea:build     # 创建 SEA 包
pnpm sea:binary    # 为当前平台构建二进制文件
pnpm build:binaries # 构建所有平台二进制文件

# 文档
pnpm docs:dev      # 启动 VitePress 开发服务器
pnpm docs:build    # 构建文档
pnpm docs:preview  # 预览构建的文档
```

### 开发环境设置

在开始开发之前，复制环境模板：

```bash
cp .env.example .env
```

`.env` 文件包含开发特定的配置，包括：

- `ONE_MCP_LOG_LEVEL=debug` - 开发增强日志记录
- `ONE_MCP_LOG_FILE=./build/1mcp.log` - 日志文件位置
- `ONE_MCP_PORT=3051` - 开发服务器端口
- `ONE_MCP_ENABLE_AUTH=true` - 启用身份验证
- `ONE_MCP_ENABLE_ASYNC_LOADING=true` - 启用异步加载
- `ONE_MCP_CONFIG_DIR=./config` - 开发自定义配置目录

## 架构概述

1MCP 遵循分层架构，具有清晰的关注点分离：

- **传输层** (`src/transport/`) - HTTP/SSE 和 STDIO 协议实现
- **应用层** (`src/commands/`) - CLI 命令和面向用户的功能
- **核心层** (`src/core/`) - 服务器管理、能力聚合、异步加载
- **支持服务** (`src/services/`, `src/config/`, `src/auth/`) - 配置、身份验证、健康监控

### 关键设计模式

- **单例模式**：ServerManager、McpConfigManager、AgentConfigManager 使用 `getInstance()`
- **工厂模式**：TransportFactory 创建特定协议的传输
- **代理模式**：1MCP 通过统一接口聚合多个 MCP 服务器
- **观察者模式**：事件驱动的加载与实时能力更新

### 核心组件

- **ServerManager** (`src/core/server/`) - 管理 MCP 服务器生命周期和连接
- **McpConfigManager** (`src/config/`) - 配置管理和热重载
- **TransportFactory** (`src/transport/`) - 创建 HTTP/STDIO 传输实例
- **CapabilitiesManager** (`src/core/capabilities/`) - 聚合来自多个服务器的工具/资源

## 调试

### 使用 MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) 作为包脚本可用：

```bash
pnpm inspector
```

Inspector 将提供一个 URL 来在浏览器中访问调试工具。

### 调试和源码映射

此项目使用 [source-map-support](https://www.npmjs.com/package/source-map-support) 来增强堆栈跟踪。当您运行服务器时，堆栈跟踪将引用原始 TypeScript 源文件而不是编译的 JavaScript。这使得调试更加容易，因为错误位置和行号将与您的源代码匹配。

无需额外设置——默认启用。如果您看到堆栈跟踪，它将指向 `.ts` 文件和正确的行号。🗺️

## 测试

### 测试配置隔离

测试 "mcp" 子命令时，始终在此项目内使用临时配置，不要破坏用户的默认配置：

```bash
# 使用临时配置目录
ONE_MCP_CONFIG_DIR=.tmp-test node build/index.js mcp add test-server -- echo '{"jsonrpc":"2.0"}'

# 或使用 --config-dir 标志
node build/index.js --config-dir .tmp-test mcp add test-server -- echo '{"jsonrpc":"2.0"}'
```

配置目录功能允许项目特定配置，这对于测试不同设置而不影响全局配置非常有用。

### 环境和配置

- 不要直接使用 ONE*MCP*\* 环境变量，而是使用 yargs 的选项，环境变量将加载到选项中
- 修改文档后应使用 `pnpm docs:build` 验证文档

### 二进制文件开发和测试

- 使用 `pnpm sea:build` 创建单可执行应用程序 (SEA) 包
- 使用 `pnpm sea:binary` 为当前平台测试二进制文件或平台特定脚本
- 二进制文件开发需要 Node.js SEA 支持和 postject 注入
- SEA 配置在 `sea-config.json` 中

### 测试基础设施

- **单元测试**：与源代码共置的 `.test.ts` 文件
- **E2E 测试**：位于 `test/e2e/` 中，具有专用配置
- **模拟实用工具**：使用 `test/unit-utils/MockFactories.ts` 进行一致的测试数据
- **测试隔离**：每个测试都应清理资源且不影响其他测试

## CLI 命令开发

添加新的 CLI 命令时：

1. **命令结构**：遵循 `src/commands/` 中的现有模式
2. **Yargs 集成**：使用适当的命令构建器和验证
3. **错误处理**：实现用户友好的错误处理
4. **测试**：为命令功能创建单元测试和 E2E 测试
5. **文档**：更新帮助文本并考虑文档影响

### MCP 命令示例

- `mcp add <name>` - 添加新的 MCP 服务器配置
- `mcp status [name]` - 显示服务器状态和健康
- `mcp list` - 列出所有配置的服务器及其标签和状态

## MCP 服务器集成模式

### 服务器生命周期管理

- MCP 服务器通过 `src/core/server/ServerManager.ts` 作为子进程管理
- 使用异步加载优雅处理启动缓慢的服务器
- 使用进程信号处理器在关闭时实现适当的清理

### 传输抽象

- HTTP 传输通过 SSE（服务器发送事件）支持多个客户端
- STDIO 传输提供直接的 MCP 协议通信
- 标签过滤允许向不同客户端选择性暴露服务器

### 配置管理

- 在不停止活动连接的情况下热重载配置
- 支持所有配置选项的环境变量覆盖
- 在应用更改之前使用 Zod 验证配置模式

### 测试 MCP 集成

测试 MCP 功能时：

```bash
# 使用临时配置测试特定 MCP 服务器
ONE_MCP_CONFIG_DIR=.tmp-test node build/index.js mcp add test-server -- echo '{"jsonrpc":"2.0"}'

# 使用不同客户端类型测试 HTTP 传输
curl "http://localhost:3050/mcp?app=cursor&tags=filesystem"

# 使用标签过滤测试 STDIO 传输
echo '{"jsonrpc":"2.0","method":"initialize","params":{}}' | node build/index.js --transport stdio --tag-filter filesystem
```

## 贡献

欢迎贡献！请阅读我们的 [CONTRIBUTING.md](https://github.com/1mcp-app/agent/blob/main/CONTRIBUTING.md) 了解我们的行为准则以及向我们提交拉取请求的过程。

### 开发指南

- 始终使用 pnpm 脚本如 "lint"、"typecheck"、"build" 和 "test" 来验证实现
- 避免在 TypeScript 中使用 "any" 关键字
- 遵循安全优先实践，使用 Zod 模式进行适当的输入清理
- 使用现有实用函数进行常见操作（分页、过滤、错误处理）
- 实现具有特定错误类型和优雅降级的适当错误处理
- 对核心管理器使用单例模式，对对象创建使用工厂模式
- 遵循具有清晰关注点分离的分层架构
- 使用 Vitest 进行测试，与源代码共置单元测试 (`.test.ts`) 和 `test/e2e/` 中的专用 E2E 测试基础设施
- 使用标签验证实现具有基于范围授权的 OAuth 2.1 身份验证
- 使用 Winston 结构化日志记录和条件日志记录函数（`debugIf`、`infoIf`、`warnIf`）
- 遵循文件系统监视器的配置管理热重载模式
- 为长时间运行的进程和子进程管理实现适当的资源清理
- 发现新错误时，始终在修复前编写正式的单元测试来重现它

## 下一步

- [配置深入指南](/zh/guide/essentials/configuration) - 详细设置选项
- [架构参考](/zh/reference/architecture) - 系统设计和模式
- [贡献指南](https://github.com/1mcp-app/agent/blob/main/CONTRIBUTING.md) - 如何贡献
