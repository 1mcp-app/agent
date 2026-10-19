---
title: MCP 卸载命令 - 安全的服务器移除
description: 安全地卸载 MCP 服务器，自动创建备份并检查依赖。移除服务器并清理配置。
head:
  - ['meta', { name: 'keywords', content: 'MCP 卸载,服务器移除,备份创建,安全删除' }]
  - ['meta', { property: 'og:title', content: '1MCP 卸载命令 - 安全的服务器移除' }]
  - ['meta', { property: 'og:description', content: '安全地卸载 MCP 服务器，自动创建备份并检查依赖。' }]
---

# mcp uninstall

安全地从您的配置中移除 MCP 服务器，自动创建备份并验证依赖。卸载命令确保安全移除并具有回滚功能。

## 概述

带确认和备份地移除服务器：

```bash
npx -y @1mcp/agent mcp uninstall <server-name>
```

跳过确认提示：

```bash
npx -y @1mcp/agent mcp uninstall <server-name> --force
```

移除而不创建备份：

```bash
npx -y @1mcp/agent mcp uninstall <server-name> --backup=false
```

## 参数

`<server-name>` (必需)
: 要卸载的服务器名称。必须是您配置中现有的服务器。

## 全局选项

- **`--config, -c <路径>`** - 指定配置文件路径
- **`--config-dir, -d <路径>`** - 配置目录路径

## 命令特定选项

- **`--force, -y`**
  - 跳过确认提示并继续卸载
  - **默认**：`false`

- **`--backup`**
  - 移除前创建备份
  - **默认**：`true`

- **`--remove-config`**
  - 从 mcp.json 中移除服务器配置
  - **默认**：`true`

- **`--verbose, -v`**
  - 显示详细的卸载信息
  - **默认**：`false`

## 示例

### 基本服务器移除

带确认和备份地移除服务器：

```bash
npx -y @1mcp/agent mcp uninstall filesystem

# 输出:
# 🔄 准备卸载 'filesystem'...
# ℹ️  服务器 'filesystem' 当前正在运行
# ℹ️  服务器具有以下功能：file_read, file_write, list_directory
# ℹ️  没有其他服务器依赖于 'filesystem'
#
# ⚠️  这将：
#   • 停止 'filesystem' 服务器
#   • 从 mcp.json 中移除服务器配置
#   • 在以下位置创建备份：~/.config/1mcp/backups/mcp-20240115-103000.json
#
# 继续？(y/N): y
#
# ✓ 服务器 'filesystem' 成功停止
# ✓ 配置已从 mcp.json 中移除
# ✓ 备份已创建：~/.config/1mcp/backups/mcp-20240115-103000.json
# ✅ 卸载成功完成
```

### 强制卸载

跳过确认提示：

```bash
npx -y @1mcp/agent mcp uninstall filesystem --force

# 输出:
# 🔄 正在卸载 'filesystem'...
# ✓ 服务器已停止
# ✓ 配置已移除
# ✓ 备份已创建
# ✅ 卸载完成
```

### 无备份卸载

移除服务器而不创建备份（不推荐）：

```bash
npx -y @1mcp/agent mcp uninstall test-server --backup=false

# 输出:
# ⚠️  跳过备份创建
# 🔄 正在卸载 'test-server'...
# ✓ 服务器已移除
# ✅ 无备份完成卸载
```

### 详细卸载

查看详细的卸载过程：

```bash
npx -y @1mcp/agent mcp uninstall database --verbose

# 输出:
# 🔍 正在分析服务器 'database'...
#   • 在 mcp.json 中找到配置
#   • 服务器当前正在运行（PID：12345）
#   • 依赖：0 个服务器依赖此服务器
#   • 备份位置：~/.config/1mcp/backups/mcp-20240115-103500.json
#
# 🛡️  安全检查通过
# 🔄 继续卸载...
#   • 优雅地停止服务器进程
#   • 从活动服务器列表中移除
#   • 更新 mcp.json 配置
#   • 创建配置备份
#
# ✅ 卸载成功完成
```

## 安全功能

### 依赖检查

卸载命令在移除前检查依赖：

```bash
npx -y @1mcp/agent mcp uninstall shared-storage

# 输出:
# ❌ 无法卸载 'shared-storage'
#
# 以下服务器依赖于 'shared-storage':
#   • file-processor（使用 shared-storage 进行临时文件存储）
#   • backup-service（使用 shared-storage 进行备份存储）
#
# 请先卸载依赖服务器或使用 --force 继续。
```

### 自动备份

默认情况下，卸载命令会创建带时间戳的备份：

```bash
# 备份位置示例：
~/.config/1mcp/backups/mcp-20240115-103000.json
~/.config/1mcp/backups/mcp-20240115-103500.json
```

备份文件包括：

- 完整的 mcp.json 配置
- 服务器元数据和安装信息
- 用于轻松识别的时间戳

### 优雅关闭

服务器在移除前会被优雅地停止：

```bash
# 优雅关闭流程：
1. 向服务器进程发送 SIGTERM 信号
2. 等待最多 10 秒进行优雅关闭
3. 如果仍在运行则发送 SIGKILL
4. 验证进程终止
5. 从服务器管理器中移除
```

## 错误处理

常见错误场景和解决方案：

```bash
# 服务器未找到
npx -y @1mcp/agent mcp uninstall nonexistent-server
# 错误：在配置中找不到服务器 'nonexistent-server'
# 使用 'mcp list' 查看可用服务器

# 服务器依赖
npx -y @1mcp/agent mcp uninstall shared-server --force
# 警告：正在移除有依赖的服务器
# 依赖将受到影响：file-processor, backup-service

# 权限问题
npx -y @1mcp/agent mcp uninstall system-server
# 错误：停止服务器进程时权限被拒绝
# 请尝试使用提升的权限或检查服务器状态
```

## 备份恢复

需要时从备份恢复：

```bash
# 列出可用备份
ls ~/.config/1mcp/backups/

# 从备份恢复
cp ~/.config/1mcp/backups/mcp-20240115-103000.json ~/.config/1mcp/mcp.json

# 重新加载配置
npx -y @1mcp/agent mcp reload
```

## 清理选项

卸载命令提供几个清理选项：

### 仅移除配置

```bash
npx -y @1mcp/agent mcp uninstall server-name --remove-config
# 从 mcp.json 中移除但如果服务器处于活动状态则保持运行
```

### 自定义备份位置

```bash
ONE_MCP_CONFIG_DIR=/custom/path npx -y @1mcp/agent mcp uninstall server-name
# 在自定义配置目录中创建备份
```

## 与注册表的集成

对于注册表安装的服务器，卸载还会：

```bash
# 移除注册表元数据
npx -y @1mcp/agent mcp uninstall filesystem

# 移除的注册表元数据：
#   • 安装时间戳
#   • 源注册表信息
#   • 版本跟踪数据
#   • 更新通知
```

## 另请参阅

- **[mcp install](install.md)** - 从注册表安装服务器
- **[mcp disable](enable-disable.md)** - 临时禁用服务器
- **[mcp list](list.md)** - 列出已安装的服务器
- **[服务器管理指南](../../guide/essentials/server-management.md)** - 完整的服务器管理概述
- **[配置参考](../../reference/mcp-servers.md)** - 配置文件结构
