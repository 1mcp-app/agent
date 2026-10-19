---
title: preset test 命令
description: 验证预设的服务器筛选条件是否符合当前配置。
---

# preset test

针对您当前的服务器配置测试预设。

有关预设管理的完整概述，请参阅 **[预设命令概述](./index)**。

## 概要

```bash
npx -y @1mcp/agent preset test <name>
```

## 参数

- **`<name>`**
  - 要测试的预设名称。
  - **必需**：是

## 描述

`preset test` 命令针对您当前的服务器配置验证预设，显示哪些服务器匹配预设的过滤条件。这对于在客户端配置中使用预设之前验证它们按预期工作至关重要。

### 测试内容

- **服务器匹配**：哪些服务器匹配预设的标签查询
- **查询验证**：预设的标签查询在语法上是否正确
- **标签可用性**：当前服务器配置中有哪些标签可用
- **配置一致性**：预设中引用的服务器是否仍然存在

## 示例

### 基本用法

```bash
# 测试开发预设
npx -y @1mcp/agent preset test development

# 测试生产预设
npx -y @1mcp/agent preset test production
```

### 示例输出

```bash
npx -y @1mcp/agent preset test development

🔍 Testing preset 'development':
   Matching servers: webserver, apiserver, devtools
   Available tags: web, api, database, development, testing, monitoring
```

### 没有匹配的服务器

```bash
npx -y @1mcp/agent preset test strict-production

🔍 Testing preset 'strict-production':
   Matching servers: none
   Available tags: web, api, development, testing

⚠️  No servers match this preset's criteria.
   Consider updating the preset or adding appropriate server tags.
```

## 输出信息

### 匹配服务器

- **服务器列表**：匹配预设条件的服务器名称
- **计数**：匹配服务器的总数
- **空结果**：如果没有服务器匹配，则明确指示

### 可用标签

- **当前标签**：在您的服务器配置中找到的所有标签
- **标签计数**：唯一标签的总数
- **覆盖范围**：帮助了解哪些标签可用于过滤

### 验证状态

- **成功**：预设查询有效并找到匹配的服务器
- **警告**：预设有效但找不到匹配的服务器
- **错误**：预设查询有语法错误或引用不存在的标签

## 用例

### 预设验证

```bash
# 验证新创建的预设工作正常
npx -y @1mcp/agent preset create team-dev --filter "web,api,development"
npx -y @1mcp/agent preset test team-dev
```

### 故障排除

```bash
# 调试预设为什么不按预期工作
npx -y @1mcp/agent preset test problematic-preset

# 与可用标签比较以识别问题
```

### 服务器配置更改

```bash
# 添加或修改服务器后，测试现有预设
npx -y @1mcp/agent preset test development
npx -y @1mcp/agent preset test production

# 确保预设仍然匹配预期的服务器
```

### 部署前验证

```bash
# 在部署配置更改前验证所有预设
for preset in $(npx -y @1mcp/agent preset list --format=names); do
  echo "Testing $preset..."
  npx -y @1mcp/agent preset test $preset
done
```

## 与开发工作流程的集成

### 服务器更改后

```bash
# 1. 修改服务器配置（添加/删除服务器或标签）
npx -y @1mcp/agent mcp add newserver --type=stdio --tags=web,api

# 2. 测试现有预设以查看影响
npx -y @1mcp/agent preset test web-services

# 3. 根据需要更新预设
npx -y @1mcp/agent preset edit web-services
```

### 客户端配置前

```bash
# 1. 测试预设以确保它匹配预期的服务器
npx -y @1mcp/agent preset test production

# 2. 为客户端配置生成 URL
npx -y @1mcp/agent preset url production

# 3. 使用验证的预设 URL 配置客户端
```

## 错误处理

### 预设未找到

```bash
npx -y @1mcp/agent preset test nonexistent
# Error: Preset 'nonexistent' not found
```

### 无效查询语法

如果预设的标签查询中有语法错误：

```bash
npx -y @1mcp/agent preset test broken-preset
# Error: Invalid tag query syntax in preset 'broken-preset': unexpected token
```

### 服务器配置问题

如果服务器配置有问题：

```bash
npx -y @1mcp/agent preset test development
# Warning: Some servers in configuration have validation errors
# Matching servers: webserver (2 servers skipped due to errors)
```

## 性能考虑

- **快速执行**：针对当前配置在内存中执行测试
- **无服务器启动**：测试查询验证而不启动实际服务器
- **批量测试**：可以快速在多个预设上运行以进行验证

## 验证级别

### 查询语法

- **有效 JSON**：标签查询必须是语法正确的 JSON
- **支持的运算符**：必须使用支持的查询运算符（`$and`、`$or`、`tag`）
- **类型安全**：标签值必须是字符串

### 服务器匹配

- **标签存在**：引用的标签必须存在于服务器配置中
- **服务器可用性**：服务器必须正确配置
- **过滤逻辑**：查询逻辑必须产生一致的结果

## 另请参阅

- **[preset show](./show)** - 显示详细的预设信息，包括服务器匹配
- **[preset create](./create)** - 创建具有特定标签条件的预设
- **[智能交互模式](./)** - 根据测试结果交互式修改预设
- **[mcp status](../mcp/status)** - 检查整体服务器配置健康状况
