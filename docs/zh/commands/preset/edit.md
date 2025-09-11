# preset edit

以可视化服务器选择交互式编辑现有预设。

有关预设管理的完整概述，请参阅 **[预设命令概述](./index)**。

## 概要

```bash
npx -y @1mcp/agent preset edit <name> [选项]
```

## 参数

- **`<name>`**
  - 要编辑的预设名称。
  - **必需**：是

## 选项

- **`--description, -d <description>`**
  - 更新预设的描述。
  - **必需**：否

## 描述

`preset edit` 命令提供了一个交互式终端用户界面（TUI）用于修改现有预设。此命令加载现有预设并允许您可视化地修改服务器选择、策略和其他设置。

### 功能

- **可视化服务器选择**，具有三态复选框（空/选中/未选中）
- **实时预览**匹配的服务器，当您进行选择时
- **策略修改**（OR/AND/Advanced），提供清晰的解释
- **返回导航**和全面的错误处理
- **描述编辑** - 在编辑期间更新预设描述
- **加载现有配置** - 在允许修改时保留当前设置

### 交互流程

1. **预设加载**：加载现有预设配置
2. **当前显示**：显示预设名称、描述和当前设置
3. **策略选择**：修改标签应该如何匹配：
   - **OR 逻辑**：具有任何选定标签的服务器
   - **AND 逻辑**：具有所有选定标签的服务器
   - **Advanced**：用于复杂过滤的自定义 JSON 查询
4. **标签选择**：可视化选择界面，包括：
   - 三态选择（空/包含/排除）
   - 每个标签的服务器计数
   - 匹配服务器的实时预览
5. **描述更新**：更新预设描述的选项
6. **保存和确认**：自动保存回相同的预设名称

## 示例

### 基本预设编辑

```bash
# 编辑开发预设
npx -y @1mcp/agent preset edit development

# 编辑生产预设
npx -y @1mcp/agent preset edit production
```

### 使用描述更新进行编辑

```bash
# 编辑预设并更新描述
npx -y @1mcp/agent preset edit staging --description "更新的暂存环境，包含监控"
```

### 示例输出

```bash
npx -y @1mcp/agent preset edit development

📁 配置目录：/Users/user/.config/1mcp

📝 正在编辑预设：development
   描述：开发服务器

[交互式 TUI 打开，加载当前配置]

✅ 预设 'development' 更新成功！
🔗 URL：http://127.0.0.1:3050/?preset=development
```

## 交互模式详情

### 服务器选择界面

交互模式提供：

- **三态复选框**：
  - `[ ]` - 未选择（服务器排除）
  - `[✓]` - 已选择（服务器包含）
  - `[-]` - 未选择（服务器排除）

- **实时预览**：显示哪些服务器与您当前选择匹配
- **标签统计**：显示每个标签的服务器计数
- **策略切换**：即时切换过滤逻辑

### 策略选项

- **OR 逻辑**：包含具有任何选定标签的服务器
- **AND 逻辑**：包含具有所有选定标签的服务器
- **Advanced**：使用带括号的复杂布尔表达式

## 使用技巧

- **编辑前查看**：使用 `preset show <name>` 查看当前配置
- **更改后测试**：运行 `preset test <name>` 验证更新的预设是否正常工作
- **更新描述**：更改预设行为时保持描述最新
- **使用实时预览**：始终检查预览以确保您的更改符合预期

## 错误处理

### 预设未找到

```bash
npx -y @1mcp/agent preset edit nonexistent
# 错误：未找到预设 'nonexistent'
```

### 配置问题

如果预设配置损坏或无法访问：

```bash
npx -y @1mcp/agent preset edit broken-preset
# 错误：无法加载预设 'broken-preset'
```

## 工作流集成

### 开发工作流

```bash
# 1. 查看当前预设
npx -y @1mcp/agent preset show development

# 2. 编辑预设以添加新服务器
npx -y @1mcp/agent preset edit development

# 3. 测试更新的预设
npx -y @1mcp/agent preset test development

# 4. 为客户端获取更新的 URL
npx -y @1mcp/agent preset url development
```

### 团队环境管理

```bash
# 当服务器配置更改时更新团队预设
npx -y @1mcp/agent preset edit team-dev
npx -y @1mcp/agent preset edit team-prod
npx -y @1mcp/agent preset edit team-staging
```

## 与其他命令的比较

### preset edit 与智能交互模式

- **`preset edit <name>`**：现有预设的直接编辑工作流
- **`1mcp preset`**：智能模式，自动检测现有预设并提供编辑选项

### preset edit 与 preset create

- **`preset edit`**：使用可视化界面修改现有预设
- **`preset create`**：从命令行过滤表达式创建新预设

## 高级用法

### 复杂配置更新

```bash
# 编辑预设以使用 AND 逻辑而不是 OR
npx -y @1mcp/agent preset edit production
# 在交互模式中：将策略从 OR 切换到 AND 逻辑

# 编辑预设以排除实验服务器
npx -y @1mcp/agent preset edit development
# 在交互模式中：选择 Advanced 策略并添加 NOT 条件
```

### 批量更新

```bash
# 使用类似更改更新多个预设
for preset in dev staging prod; do
  echo "正在编辑 $preset..."
  npx -y @1mcp/agent preset edit $preset
done
```

## 最佳实践

### 编辑前

1. **备份重要预设**：使用 `preset show <name>` 记录当前状态
2. **测试当前预设**：运行 `preset test <name>` 建立基线
3. **检查团队依赖项**：确保没有团队成员正在使用该预设
4. **计划更改**：知道您要添加或删除哪些服务器/标签

### 编辑期间

1. **使用实时预览**：保存前始终验证匹配的服务器
2. **更新描述**：更改行为时保持描述准确
3. **测试策略**：尝试不同的过滤策略以找到最佳策略
4. **经常保存**：交互模式在您退出时自动保存

### 编辑后

1. **测试预设**：使用 `preset test <name>` 验证其按预期工作
2. **更新团队文档**：将重大更改告知团队成员
3. **更新客户端配置**：如需要共享新的 URL
4. **监控使用情况**：在实践中检查更新的预设是否良好工作

## 另请参阅

- **[智能交互模式](./)** - 自动检测现有预设并提供编辑选项
- **[preset show](./show)** - 编辑前显示详细预设信息
- **[preset test](./test)** - 进行更改后测试预设
- **[preset create](./create)** - 创建新预设
- **[preset list](./list)** - 列出所有可用预设
