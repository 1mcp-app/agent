---
title: preset list 命令
description: 列出已配置预设及其筛选摘要。
---

# preset list

以格式化表格显示所有可用的预设。

有关预设管理的完整概述，请参阅 **[预设命令概述](./index)**。

## 概要

```bash
npx -y @1mcp/agent preset list
```

## 全局选项

此命令支持所有全局选项：

- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

## 描述

`preset list` 命令以紧凑、有组织的表格格式显示所有配置的预设。这提供了预设配置的快速概览，包括名称、策略、查询摘要和使用信息。

### 输出格式

命令显示：

- **标题**：找到的预设总数
- **表格**：包含预设信息的组织列
- **快速参考**：预设管理的可用命令

### 表格列

- **名称**：预设标识符（如果超过 16 个字符则截断）
- **策略**：过滤方法（OR 逻辑、AND 逻辑、Advanced）
- **查询**：标签查询摘要（如果超过 33 个字符则截断）

## 示例

### 基本用法

```bash
# 列出所有预设
npx -y @1mcp/agent preset list
```

### 示例输出

```
┌─────────────── Preset Manager ──────────────┐
│   📋 Available Presets                      │
│   Found 3 presets in your configuration     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Name              Strategy   Query                               │
│  ────────────────  ─────────  ──────────────────────────────────  │
│  dev              OR logic   {"$or":[...                        │
│  production       Advanced  {"$and":[...                       │
│  staging          OR logic   {"tag":"staging"}                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────── Quick Reference ─────────────┐
│  Available Commands:                     │
│                                          │
│  • preset show <name>    Show details   │
│  • preset url <name>     Generate URL   │
│  • preset test <name>    Test preset    │
│  • preset delete <name>  Delete preset  │
└──────────────────────────────────────────┘
```

## 理解输出

### 空配置

如果不存在预设，命令会显示有用的指导：

```
┌──── No Presets Available ─────┐
│   ⚠️  No presets found        │
└───────────────────────────────┘

Create your first preset with:
  preset create <name> --filter "web,api"
  1mcp preset
```

### 策略类型

- **OR 逻辑**：匹配具有任何选定标签的服务器
- **AND 逻辑**：匹配具有所有选定标签的服务器
- **Advanced**：使用自定义 JSON 查询进行复杂过滤

### 查询截断

长查询会截断为 "..." 以保持表格格式。使用 `preset show <name>` 查看完整查询。

## 工作流程集成

list 命令与其他预设命令配合良好：

```bash
# 1. 列出所有预设以查看可用的选项
npx -y @1mcp/agent preset list

# 2. 显示特定预设的详细信息
npx -y @1mcp/agent preset show production

# 3. 测试预设以查看匹配的服务器
npx -y @1mcp/agent preset test production

# 4. 为客户端配置生成 URL
npx -y @1mcp/agent preset url production
```

## 使用技巧

- **定期审查**：使用 `preset list` 定期审查您的预设配置
- **清理旧预设**：查找不需要的预设
- **快速扫描**：表格格式使比较策略和识别预设变得容易
- **跟进详细信息**：需要完整信息时使用 `preset show <name>`

## 另请参阅

- **[preset show](./show)** - 显示详细的预设信息（完整查询、匹配服务器）
- **[preset create](./create)** - 从命令行创建新预设
- **[智能交互模式](./)** - 使用交互式 TUI 创建预设
- **[preset delete](./delete)** - 删除未使用的预设
