# preset show

显示特定预设的详细信息。

有关预设管理的完整概述，请参阅 **[预设命令概述](./index)**。

## 概要

```bash
npx -y @1mcp/agent preset show <name>
```

## 参数

- **`<name>`**
  - 要显示详细信息的预设名称。
  - **必需**：是

## 全局选项

此命令支持所有全局选项：

- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

## 描述

`preset show` 命令在单个、有组织的显示中提供特定预设的全面信息。这通过显示完整的细节而不截断来补充紧凑的 `preset list` 表格。

### 显示的信息

- **基本信息**：名称、策略、描述、创建日期
- **客户端 URL**：用于 MCP 客户端配置的即用型 URL
- **标签查询**：具有适当格式的完整 JSON 查询（无截断）
- **服务器匹配**：哪些服务器匹配预设条件
- **快速操作**：与预设相关的常见命令

## 示例

### 基本用法

```bash
# 显示特定预设的详细信息
npx -y @1mcp/agent preset show development

# 显示生产预设信息
npx -y @1mcp/agent preset show production
```

### 示例输出

```
┌─────────── Preset Details ────────────┐
│ 📋 development                        │
│ Strategy: OR logic - Match ANY tags   │
│ Description: Development servers      │
│ Created: 9/6/2025                     │
│                                       │
│ Client URL:                           │
│ http://127.0.0.1:3050/?preset=dev     │
│                                       │
│ Tag Query:                            │
│ {                                     │
│   "$or": [                            │
│     { "tag": "web" },                 │
│     { "tag": "api" }                  │
│   ]                                   │
│ }                                     │
│                                       │
│ Matching Servers (2):                 │
│ • webserver, • apiserver              │
│                                       │
│ Quick Actions:                        │
│ • Test: preset test development       │
│ • Edit: 1mcp preset edit dev         │
│ • URL:  preset url development        │
└───────────────────────────────────────┘
```

## 信息部分

### 基本信息

- **名称**：预设标识符
- **策略**：人类可读的策略描述
- **描述**：可选的用户提供的描述
- **创建**：预设首次创建的时间

### 客户端 URL

用于配置 MCP 客户端的生成 URL：

- **格式**：`http://host:port/?preset=name`
- **用法**：将此 URL 复制到您的 MCP 客户端配置中
- **动态**：自动解析到适当的服务器子集

### 标签查询

过滤条件的完整 JSON 表示：

- **无截断**：完整查询显示，格式正确
- **语法高亮**：JSON 结构清晰格式化
- **策略映射**：显示您的选择如何转换为查询

### 服务器匹配

将预设应用于当前配置的实时结果：

- **匹配计数**：匹配条件的服务器数量
- **服务器列表**：匹配服务器的名称（或"没有服务器匹配"）
- **实时结果**：基于您当前的服务器配置

### 快速操作

与此预设相关的便捷命令：

- **测试**：`preset test <name>` - 验证服务器匹配
- **编辑**：`1mcp preset edit <name>` - 修改预设
- **URL**：`preset url <name>` - 仅获取客户端 URL

## 用例

### 开发工作流程

```bash
# 在使用前审查预设
npx -y @1mcp/agent preset show development

# 将客户端 URL 复制到您的 MCP 客户端配置中
# 使用匹配服务器信息验证包含正确的服务器
```

### 团队协作

```bash
# 与团队成员共享预设详细信息
npx -y @1mcp/agent preset show team-production

# 团队成员可以看到确切的配置和匹配的服务器
```

### 故障排除

```bash
# 调试预设为什么不按预期工作
npx -y @1mcp/agent preset show problematic-preset

# 检查标签查询部分的语法问题
# 查看匹配服务器以查看实际结果
```

## 错误处理

### 预设未找到

```bash
npx -y @1mcp/agent preset show nonexistent
# Error: Preset 'nonexistent' not found
```

### 无效预设

如果预设存在但有验证问题，命令会在匹配服务器部分显示错误详细信息。

## 工作流程集成

常见用法模式：

```bash
# 1. 列出预设以查看可用选项
npx -y @1mcp/agent preset list

# 2. 显示特定预设的详细信息
npx -y @1mcp/agent preset show staging

# 3. 如果需要测试预设
npx -y @1mcp/agent preset test staging

# 4. 在您的 MCP 客户端中使用客户端 URL
```

## 另请参阅

- **[preset list](./list)** - 表格格式的所有预设概览
- **[preset test](./test)** - 测试预设服务器匹配，包含其他详细信息
- **[preset url](./url)** - 仅获取预设的客户端 URL
- **[智能交互模式](./)** - 自动检测现有预设并提供编辑选项
