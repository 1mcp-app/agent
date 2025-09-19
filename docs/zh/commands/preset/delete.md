# preset delete

从您的配置中删除预设。

有关预设管理的完整概述，请参阅 **[预设命令概述](./index)**。

## 概要

```bash
npx -y @1mcp/agent preset delete <name>
```

## 参数

- **`<name>`**
  - 要删除的预设名称。
  - **必需**：是

## 描述

`preset delete` 命令从您的配置中永久删除预设。这对于清理未使用的预设或删除过时的配置很有用。

### 安全功能

- **确认提示**：在删除前要求确认
- **预设验证**：在尝试删除前验证预设存在
- **原子操作**：要么完全删除，要么失败而不进行部分更改
- **备份建议**：提醒用户重要预设的备份选项

## 示例

### 基本用法

```bash
# 删除特定预设
npx -y @1mcp/agent preset delete old-staging

# 删除开发预设
npx -y @1mcp/agent preset delete temp-dev
```

### 示例输出

```bash
npx -y @1mcp/agent preset delete old-staging

⚠️  Delete preset 'old-staging'?
   This action cannot be undone.

   Preset details:
   • Strategy: OR logic
   • Created: 8/15/2025

? Are you sure? (y/N) y

✅ Preset 'old-staging' deleted successfully.
```

### 确认拒绝

```bash
npx -y @1mcp/agent preset delete production

⚠️  Delete preset 'production'?
   This action cannot be undone.

   Preset details:
   • Strategy: Advanced
   • Created: 9/1/2025

? Are you sure? (y/N) n

❌ Deletion cancelled.
```

## 用例

### 配置清理

```bash
# 审查未使用的预设
npx -y @1mcp/agent preset list

# 删除在预设列表中显示的未使用预设
npx -y @1mcp/agent preset delete unused-preset
npx -y @1mcp/agent preset delete old-experiment
```

### 开发工作流程

```bash
# 测试后清理临时预设
npx -y @1mcp/agent preset delete test-temp
npx -y @1mcp/agent preset delete debug-session
npx -y @1mcp/agent preset delete experiment-2024
```

### 团队环境管理

```bash
# 删除已弃用的团队预设
npx -y @1mcp/agent preset delete legacy-prod
npx -y @1mcp/agent preset delete old-team-config
```

## 安全考虑

### 重要预设

在删除正在使用的预设之前：

1. **检查预设列表**：在 `preset list` 中查看所有预设
2. **验证影响**：确保没有团队成员依赖该预设
3. **记录更改**：告知团队预设删除
4. **考虑重命名**：考虑重命名以提高清晰度，而不是删除

### 备份策略

```bash
# 删除前导出预设配置（手动备份）
npx -y @1mcp/agent preset show important-preset > backup-important-preset.txt

# 然后根据需要删除
npx -y @1mcp/agent preset delete important-preset
```

## 错误处理

### 预设未找到

```bash
npx -y @1mcp/agent preset delete nonexistent
# Error: Preset 'nonexistent' not found
```

### 权限问题

如果存在文件系统权限问题：

```bash
npx -y @1mcp/agent preset delete locked-preset
# Error: Unable to delete preset: Permission denied
```

### 配置文件问题

如果预设配置文件已损坏：

```bash
npx -y @1mcp/agent preset delete corrupted-preset
# Error: Unable to read preset configuration file
```

## 工作流程集成

### 定期维护

```bash
# 1. 审查所有预设
npx -y @1mcp/agent preset list

# 2. 识别未使用的预设（创建日期较早）
# 3. 与团队验证预设确实未使用
# 4. 删除未使用的预设
npx -y @1mcp/agent preset delete unused-1
npx -y @1mcp/agent preset delete unused-2

# 5. 验证清理
npx -y @1mcp/agent preset list
```

### 项目更改后

```bash
# 当项目需求更改时，删除过时的预设
npx -y @1mcp/agent preset delete old-architecture
npx -y @1mcp/agent preset delete deprecated-stack
```

## 最佳实践

### 删除前

1. **验证预设使用情况**：检查是否有任何团队成员正在使用该预设
2. **记录依赖项**：确保没有自动化脚本引用该预设
3. **检查客户端配置**：验证没有 MCP 客户端使用预设 URL
4. **考虑归档**：对于重要的历史预设，在删除前导出

### 批量删除

对于多个预设，一次删除一个以保持控制：

```bash
# 避免批量删除脚本 - 为安全起见单独删除
npx -y @1mcp/agent preset delete preset1
npx -y @1mcp/agent preset delete preset2
```

### 团队协调

- **传达更改**：在删除共享预设之前通知团队成员
- **更新文档**：从团队文档中删除对已删除预设的引用
- **提供替代方案**：如果有可用的替代预设，请建议

## 恢复

### 无内置恢复

一旦预设被删除，无法通过 CLI 恢复。但是：

1. **手动重新创建**：使用 `preset create` 或 `1mcp preset` 重新创建
2. **备份文件**：如果您之前导出了预设详细信息
3. **版本控制**：如果您的配置受版本控制
4. **团队知识**：其他团队成员可能具有相同的预设

### 预防

```bash
# 删除前导出预设详细信息以备潜在恢复
npx -y @1mcp/agent preset show critical-preset > critical-preset-backup.json
npx -y @1mcp/agent preset delete critical-preset
```

## 另请参阅

- **[preset list](./list)** - 删除前审查预设
- **[preset show](./show)** - 导出预设详细信息以备份
- **[preset create](./create)** - 重新创建已删除的预设
- **[智能交互模式](./)** - 交互式重新创建已删除的预设
