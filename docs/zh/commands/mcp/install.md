---
title: MCP 安装命令 - 基于注册表的服务器安装
description: 从 1MCP 注册表安装 MCP 服务器，支持交互式向导。发现并安装具有版本管理和依赖解析的服务器。
head:
  - ['meta', { name: 'keywords', content: 'MCP 安装,注册表服务器安装,交互式向导,服务器发现' }]
  - ['meta', { property: 'og:title', content: '1MCP 安装命令 - 注册表服务器安装' }]
  - ['meta', { property: 'og:description', content: '使用交互式向导和版本管理从注册表安装 MCP 服务器。' }]
---

# mcp install

从 1MCP 注册表安装 MCP 服务器，具有自动依赖解析和版本管理功能。安装命令提供交互式向导引导安装和按名称直接安装服务器。

> **注意**：这是向配置中添加 MCP 服务器推荐的方式。对于手动配置，请参阅 [add 命令](add.md)。

## 命令语法

启动交互式安装向导：

```bash
npx -y @1mcp/agent mcp install
```

按名称从注册表安装服务器：

```bash
npx -y @1mcp/agent mcp install <server-name>
```

安装特定版本：

```bash
npx -y @1mcp/agent mcp install <server-name>@<version>
```

预览安装而不进行更改：

```bash
npx -y @1mcp/agent mcp install <server-name> --dry-run
```

强制重新安装：

```bash
npx -y @1mcp/agent mcp install <server-name> --force
```

## 参数

- **`<server-name>`** (可选)
  - 服务器名称或 name@version 进行安装。可以包含完整的注册表 ID（例如：`io.github.user/filesystem`）。
  - **必需**: 否

## 全局选项

此命令支持所有全局选项：

- **`--config, -c <路径>`** - 指定配置文件路径
- **`--config-dir, -d <路径>`** - 配置目录路径

## 命令特定选项

- **`--interactive, -i`**
  - 启动交互式安装向导。当未提供服务器名称时，这是默认选项。

- **`--force`**
  - 即使服务器已存在也强制安装。覆盖现有配置。

- **`--dry-run`**
  - 显示将要安装的内容，而不对配置进行任何更改。

- **`--verbose, -v`**
  - 显示详细的安装信息。

## 示例

### 基本服务器安装

安装文件系统服务器的最新版本：

```bash
npx -y @1mcp/agent mcp install filesystem
```

安装特定版本：

```bash
npx -y @1mcp/agent mcp install filesystem@1.2.0
```

### 交互式向导安装

启动交互式向导来浏览和安装服务器：

```bash
npx -y @1mcp/agent mcp install --interactive
```

向导将指导您完成以下步骤：

1. **服务器发现** - 按类别浏览可用服务器
2. **版本选择** - 选择兼容版本
3. **配置** - 设置服务器特定选项
4. **安装** - 确认并安装及其依赖

### 安装预览

预览将要安装的内容而不进行更改：

```bash
npx -y @1mcp/agent mcp install filesystem --dry-run

# 输出:
# 📦 安装预览: filesystem@1.2.0
#
# 服务器: filesystem - 文件系统访问和管理
# 版本: 1.2.0
# 类别: 系统
# 标签: filesystem, files, local
#
# 依赖: 无
# 配置: 将提示输入根目录
#
# 使用 --verbose 获取详细信息
```

### 强制重新安装

替换现有服务器配置：

```bash
npx -y @1mcp/agent mcp install filesystem --force
```

### 详细安装

查看包含依赖解析的详细安装过程：

```bash
npx -y @1mcp/agent mcp install airtable --verbose

# 输出:
# 🔍 解析 airtable@2.1.0 的依赖...
# ✓ 依赖检查完成
# 📥 下载服务器元数据...
# ✓ 验证服务器配置
# ⚙️  生成配置...
# ✓ 服务器成功安装为 'airtable'
```

## 交互式向导工作流程

当使用 `--interactive` 或不带参数运行时，安装命令会启动交互式向导：

1. **搜索或浏览**
   - 按服务器名称或类别搜索
   - 按类别浏览（系统、数据库、网络、开发等）
   - 按标签和兼容性筛选

2. **服务器选择**
   - 查看服务器描述和功能
   - 检查版本兼容性
   - 检查依赖和要求

3. **版本选择**
   - 从可用版本中选择
   - 查看版本说明和兼容性
   - 获取稳定版与最新版的建议

4. **配置**
   - 设置服务器特定参数
   - 选择用于组织的标签
   - 配置传输选项（如适用）

5. **确认**
   - 审查完整配置
   - 查看将要安装的内容
   - 确认安装

## 注册表集成

安装命令与 1MCP 注册表集成，提供以下功能：

- **服务器发现**：搜索和浏览可用的 MCP 服务器
- **版本管理**：安装特定版本并检查兼容性
- **依赖解析**：自动安装所需的依赖
- **安全验证**：验证服务器完整性和真实性
- **更新通知**：获取可用更新通知

## 配置输出

已安装的服务器会添加到您的 `mcp.json` 配置中，包含注册表元数据：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
      "tags": ["filesystem", "files", "local"],
      "_registry": {
        "name": "filesystem",
        "version": "1.2.0",
        "installedAt": "2024-01-15T10:30:00Z",
        "source": "1mcp-registry"
      }
    }
  }
}
```

## 错误处理

安装命令为常见场景提供有用的错误消息：

```bash
# 服务器未找到
npx -y @1mcp/agent mcp install nonexistent-server
# 错误：在注册表中找不到服务器 'nonexistent-server'
# 建议：filesystem, git, database, search

# 版本不可用
npx -y @1mcp/agent mcp install filesystem@99.99.99
# 错误：'filesystem' 的版本 99.99.99 不可用
# 可用版本：1.2.0, 1.1.0, 1.0.0

# 已安装
npx -y @1mcp/agent mcp install filesystem
# 错误：服务器 'filesystem' 已安装
# 使用 --force 重新安装或使用 mcp update 升级
```

## 另请参阅

- **[注册表搜索](../registry/search.md)** - 在注册表中搜索可用服务器
- **[mcp uninstall](uninstall.md)** - 移除已安装的服务器
- **[mcp update](update.md)** - 更新已安装的服务器
- **[服务器管理指南](../../guide/essentials/server-management.md)** - 完整的服务器管理概述
- **[注册表命令](../registry/)** - 完整的注册表命令文档
