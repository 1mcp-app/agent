---
title: 注册表命令 - MCP 服务器发现和管理
description: 1MCP 注册表命令的完整指南，用于服务器发现、安装、版本管理和依赖解析。
head:
  - ['meta', { name: 'keywords', content: 'MCP 注册表,服务器发现,版本管理,依赖解析' }]
  - ['meta', { property: 'og:title', content: '1MCP 注册表命令 - 服务器发现和管理' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: '通过 1MCP 注册表发现、安装和管理 MCP 服务器，具有版本控制和依赖管理功能。',
      },
    ]
---

# 注册表命令

1MCP 注册表为 MCP 服务器提供集中式服务器发现、版本管理和依赖解析。注册表命令使您能够搜索服务器、查看详细信息、检查版本并管理服务器安装。

> **快速开始**：使用 `npx @1mcp/agent mcp install <服务器名称>` 进行简化安装。

## 概述

1MCP 注册表是一个集中式存储库，它：

- **发现**跨类别的可用 MCP 服务器
- **管理**版本控制和兼容性信息
- **自动解析**依赖
- **验证**服务器完整性和安全性
- **提供**详细的服务器元数据和文档

## 可用命令

### 服务器发现

- **[registry search](search.md)** - 按名称、类别或标签搜索服务器

## 注册表工作流程

### 1. 发现

找到符合您需求的服务器：

```bash
# 按类别搜索
npx -y @1mcp/agent registry search --category=filesystem

# 按功能搜索
npx -y @1mcp/agent registry search "database"

# 浏览所有服务器
npx -y @1mcp/agent registry search
```

### 2. 信息收集

获取服务器的详细信息：

```bash
# 查看服务器详情
npx -y @1mcp/agent registry show filesystem

# 检查可用版本
npx -y @1mcp/agent registry versions filesystem

# 查看依赖和要求
npx -y @1mcp/agent registry show postgresql --deps
```

### 3. 安装

安装服务器并自动解析依赖：

```bash
# 安装最新版本
npx -y @1mcp/agent mcp install filesystem

# 安装特定版本
npx -y @1mcp/agent mcp install filesystem@1.2.0

# 使用交互式向导安装
npx -y @1mcp/agent mcp install --interactive
```

### 4. 管理

保持服务器更新和管理：

```bash
# 检查更新
npx -y @1mcp/agent registry updates

# 更新特定服务器
npx -y @1mcp/agent mcp update filesystem

# 移除服务器
npx -y @1mcp/agent mcp uninstall filesystem
```

## 服务器类别

注册表将服务器组织成功能性类别：

### 系统和文件管理

- **文件系统** - 文件系统访问和操作
- **数据库** - 数据库连接和操作
- **存储** - 云存储和对象管理
- **备份** - 数据备份和恢复工具

### 开发工具

- **Git** - 版本控制和仓库操作
- **构建** - 构建系统和编译工具
- **测试** - 测试框架和实用程序
- **调试** - 调试和分析工具

### 网络和网络

- **HTTP** - HTTP 客户端和 API 工具
- **搜索** - 网络搜索和信息检索
- **抓取** - 网络抓取和数据提取
- **API** - API 集成和管理

### 数据处理

- **分析** - 数据分析和报告
- **机器学习** - 机器学习模型服务和训练
- **ETL** - 数据转换和管道
- **可视化** - 数据可视化工具

### 通信

- **电子邮件** - 电子邮件发送和管理
- **聊天** - 消息传递和通信平台
- **日历** - 日历和计划工具
- **通知** - 警报和通知系统

## 服务器元数据

注册表中的每个服务器都包含全面的元数据：

```json
{
  "name": "filesystem",
  "displayName": "File System Server",
  "description": "文件系统访问和管理功能",
  "version": "1.2.0",
  "category": "System",
  "tags": ["filesystem", "files", "local", "storage"],
  "maintainer": "Model Context Protocol Team",
  "license": "MIT",
  "homepage": "https://github.com/modelcontextprotocol/servers",
  "repository": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  "documentation": "https://docs.modelcontextprotocol.io/servers/filesystem",
  "dependencies": [],
  "engines": {
    "node": ">=14.0.0"
  },
  "platforms": ["linux", "darwin", "win32"],
  "transport": ["stdio"],
  "capabilities": {
    "tools": ["read_file", "write_file", "list_directory", "create_directory"],
    "resources": ["file://*"]
  },
  "security": {
    "trusted": true,
    "sandboxed": false,
    "permissions": ["filesystem"]
  },
  "installation": {
    "npm": "@modelcontextprotocol/server-filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem"]
  },
  "changelog": "https://github.com/modelcontextprotocol/servers/blob/main/CHANGELOG.md"
}
```

## 版本管理

注册表遵循语义版本控制（SemVer）：

- **主版本** - 破坏性更改
- **次版本** - 新功能（向后兼容）
- **修订版本** - 错误修复（向后兼容）

### 版本选择

```bash
# 安装最新的稳定版本
npx -y @1mcp/agent mcp install filesystem

# 安装特定的主版本
npx -y @1mcp/agent mcp install filesystem@1

# 安装特定的次版本
npx -y @1mcp/agent mcp install filesystem@1.2

# 安装确切版本
npx -y @1mcp/agent mcp install filesystem@1.2.0

# 安装预发布版本
npx -y @1mcp/agent mcp install filesystem@2.0.0-beta.1
```

## 安全和信任

注册表包含安全验证：

- **受信任的来源** - 已验证的维护者和存储库
- **漏洞扫描** - 自动安全检查
- **依赖审核** - 包依赖安全分析
- **代码审查** - 社区审查流程

## 私有注册表

用于企业和私有服务器管理：

```bash
# 配置私有注册表
npx -y @1mcp/agent registry config --add private.registry.com

# 与私有注册表进行身份验证
npx -y @1mcp/agent registry login private.registry.com

# 搜索私有注册表
npx -y @1mcp/agent registry search --registry=private.registry.com
```

## 与 MCP 命令的集成

注册表命令与 MCP 命令无缝集成：

```bash
# 这些是等效的：
npx -y @1mcp/agent registry search filesystem
npx -y @1mcp/agent mcp install --search filesystem

# 从注册表搜索结果安装
npx -y @1mcp/agent registry search database | head -5 | xargs -I {} npx -y @1mcp/agent mcp install {}

# 检查所有已安装服务器的更新
npx -y @1mcp/agent registry updates --installed
```

## 缓存管理

注册表操作使用本地缓存以提高性能：

```bash
# 清除注册表缓存
npx -y @1mcp/agent registry cache --clear

# 强制刷新服务器信息
npx -y @1mcp/agent registry show filesystem --refresh

# 设置缓存过期
npx -y @1mcp/agent registry config --cache-expire=1h
```

## 最佳实践

### 服务器选择

1. **检查兼容性** - 确保服务器匹配您的环境
2. **审查依赖** - 了解所需的依赖
3. **阅读文档** - 审查服务器功能和限制
4. **检查维护** - 优先选择积极维护的服务器
5. **在开发中测试** - 在非生产环境中验证服务器

### 版本管理

1. **使用特定版本** - 为生产稳定性固定版本
2. **测试更新** - 在升级前验证新版本
3. **监控变更日志** - 跟踪更改和弃用
4. **备份配置** - 保留工作配置的备份
5. **回滚计划** - 准备降级策略

### 安全性

1. **验证来源** - 仅使用来自受信任维护者的服务器
2. **审查权限** - 了解服务器访问要求
3. **定期更新** - 为安全补丁保持服务器更新
4. **隔离环境** - 为不同环境使用单独的配置
5. **审核依赖** - 监控依赖安全更新

## 另请参阅

- **[mcp install](../mcp/install.md)** - 从注册表安装服务器
- **[mcp uninstall](../mcp/uninstall.md)** - 移除已安装的服务器
- **[服务器管理指南](../../guide/essentials/server-management.md)** - 完整的服务器管理
- **[配置参考](../../reference/mcp-servers.md)** - 配置详细信息
- **[入门指南](../../guide/getting-started.md)** - 初始设置说明
