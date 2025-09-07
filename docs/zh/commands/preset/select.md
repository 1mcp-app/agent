# preset select

基于 TUI 的交互式预设创建和编辑，具有可视化服务器选择功能。

有关预设管理的完整概述，请参阅 **[预设命令概述](./index)**。

## 概要

```bash
# 以交互方式创建新预设
npx -y @1mcp/agent preset select --save <name> [options]

# 编辑现有预设
npx -y @1mcp/agent preset select --load <name> [options]
```

## 选项

- **`--save <name>`**
  - 在选择后使用指定名称保存新预设。
  - **必需**：否（但必须指定 --save 或 --load）

- **`--load <name>`**
  - 加载并编辑具有指定名称的现有预设。
  - **必需**：否（但必须指定 --save 或 --load）

- **`--url`**
  - 保存预设后显示生成的 URL。
  - **必需**：否

## 描述

`preset select` 命令提供了一个交互式终端用户界面（TUI）来创建和编辑预设。这是推荐的方法，适合偏好可视化选择并希望交互式探索可用服务器和标签的用户。

### 功能

- **可视化服务器选择**，具有三态复选框（空/选中/未选中）
- **实时预览**匹配的服务器，当您进行选择时
- **策略选择**（OR/AND/Advanced），带有清晰的解释
- **返回导航**和全面的错误处理
- **基于标签的过滤**，带有服务器计数指示器

### 交互流程

1. **策略选择**：选择标签应该如何匹配：
   - **OR 逻辑**：具有任何选定标签的服务器
   - **AND 逻辑**：具有所有选定标签的服务器
   - **Advanced**：用于复杂过滤的自定义 JSON 查询

2. **标签选择**：可视化选择界面，具有：
   - 三态选择（空/包含/排除）
   - 每个标签的服务器计数
   - 匹配服务器的实时预览

3. **预览和确认**：在保存前审查您的选择

## 示例

### 创建新预设

```bash
# 基本预设创建
npx -y @1mcp/agent preset select --save development

# 创建预设并立即显示 URL
npx -y @1mcp/agent preset select --save staging --url
```

### 编辑现有预设

```bash
# 加载和修改现有预设
npx -y @1mcp/agent preset select --load development

# 加载现有预设并在更改后显示 URL
npx -y @1mcp/agent preset select --load production --url
```

## 使用技巧

- **先探索**：使用交互式界面在创建预设之前了解您的可用服务器和标签
- **预览结果**：始终检查实时预览以确保您的选择符合预期
- **使用描述**：在提示时添加有意义的描述，以便稍后识别预设
- **创建后测试**：运行 `preset test <name>` 验证您的预设按预期工作

## 另请参阅

- **[preset create](./create)** - 使用过滤表达式进行命令行预设创建
- **[preset list](./list)** - 列出所有可用的预设
- **[preset show](./show)** - 显示详细的预设信息
- **[preset test](./test)** - 测试预设服务器匹配
