---
title: 服务器管理指南 - 基于注册表的安装和配置
description: 学习如何使用基于注册表的方法在 1MCP 中管理 MCP 服务器，包括服务器发现、安装和生命周期管理。
head:
  - ['meta', { name: 'keywords', content: 'MCP 服务器管理,注册表安装,服务器发现,生命周期管理' }]
  - ['meta', { property: 'og:title', content: '1MCP 服务器管理指南 - 基于注册表的方法' }]
  - ['meta', { property: 'og:description', content: '使用基于注册表的安装和配置在 1MCP 中管理 MCP 服务器的完整指南。' }]
---

# 服务器管理指南

本指南提供了在您的 1MCP 实例中使用推荐的基于注册表的方法管理 MCP 服务器的全面概述，包括服务器发现、安装和生命周期管理。

## 基于注册表的工作流程（推荐）

1MCP 注册表提供了一个用于发现、安装和管理 MCP 服务器的集中式存储库，具有自动依赖解析和版本管理功能。这是推荐的服务器管理方法。

### 快速开始

从注册表安装您的第一个服务器：

```bash
# 搜索可用的服务器
npx -y @1mcp/agent registry search --category=filesystem

# 安装文件系统服务器
npx -y @1mcp/agent mcp install filesystem

# 或使用交互式向导
npx -y @1mcp/agent mcp wizard
```

### 注册表工作流程

1. **发现** - 找到符合您需求的服务器
2. **选择** - 选择具有版本兼容性的服务器
3. **安装** - 自动依赖解析和设置
4. **配置** - 服务器特定的自定义
5. **管理** - 更新、移除和生命周期控制

### 注册表优势

- **服务器发现** - 浏览和搜索数百个 MCP 服务器
- **版本管理** - 安装具有兼容性检查的特定版本
- **依赖解析** - 自动安装所需依赖项
- **安全验证** - 具有完整性检查的已验证服务器
- **更新管理** - 具有更改跟踪的简便更新
- **交互式安装** - 使用配置向导进行引导设置

### 安装方法

#### 直接安装

按名称从注册表安装服务器：

```bash
# 安装最新版本
npx -y @1mcp/agent mcp install filesystem

# 安装特定版本
npx -y @1mcp/agent mcp install filesystem@1.2.0

# 带配置安装
npx -y @1mcp/agent mcp install git --repository /path/to/project
```

#### 交互式向导

启动配置向导进行引导安装：

```bash
# 启动交互式向导
npx -y @1mcp/agent mcp wizard

# 使用预定义模板启动
npx -y @1mcp/agent mcp wizard --template development
```

向导提供：

- 按类别浏览服务器
- 分步配置
- 兼容性检查
- 最佳实践建议

#### 搜索和安装

搜索注册表并从结果中安装：

```bash
# 搜索数据库服务器
npx -y @1mcp/agent registry search database

# 安装搜索结果
npx -y @1mcp/agent registry search database --limit=3 --output=list | \
  xargs -n1 npx -y @1mcp/agent mcp install
```

## 传输类型

1MCP 支持多种传输类型以连接到 MCP 服务器。

### STDIO 传输

这是本地 MCP 服务器最常见的传输方式。1MCP 将服务器作为子进程启动，并通过标准输入和标准输出与其通信。

**用例**：运行 `mcp-server-filesystem` 或 `mcp-server-git` 等本地工具。

**配置示例**：

```bash
npx -y @1mcp/agent mcp add filesystem --type=stdio --command="mcp-server-filesystem" --args="--root ~/"
```

**主要功能**：

- **进程管理**：1MCP 管理服务器进程的生命周期。
- **环境变量**：将环境变量直接传递给服务器进程。
- **工作目录**：为服务器指定自定义工作目录。

### 可流式 HTTP 传输

此传输连接到已在运行并通过 HTTP 端点公开的 MCP 服务器。

**用例**：连接到远程 MCP 服务器，或作为另一个应用程序一部分运行的服务器。

**配置示例**：

```bash
npx -y @1mcp/agent mcp add remote-api --type=http --url="https://mcp.example.com/"
```

**主要功能**：

- **远程访问**：连接到本地网络或互联网上的服务器。
- **自定义标头**：添加自定义 HTTP 标头用于身份验证或其他目的。
- **连接池**：高效管理到远程服务器的连接。

### SSE 传输（已弃用）

Server-Sent Events 是已弃用的传输类型。建议改用 HTTP 传输。

## Server Configuration Details

Each server you define in 1MCP has a set of common configuration options:

- **Name**: A unique, human-readable name for the server (e.g., `my-git-server`).
- **Transport**: The transport type (`stdio` or `http`).
- **Command/URL**: The command to execute for `stdio` transports, or the URL for `http` transports.
- **Arguments**: An array of command-line arguments for `stdio` servers.
- **Environment**: Key-value pairs of environment variables for `stdio` servers.
- **Tags**: A list of tags for organizing and filtering servers.
- **Timeout**: A connection timeout in milliseconds.
- **Enabled/Disabled**: A flag to enable or disable the server without deleting its configuration.

## Server Management Workflow

### Registry-Based Workflow (Recommended)

The modern workflow using the registry provides automatic dependency resolution and version management:

1.  **Discover Servers**: Search the registry for servers that meet your needs.

    ```bash
    # Search for development servers
    npx -y @1mcp/agent registry search --category=development

    # Browse all available servers
    npx -y @1mcp/agent mcp wizard
    ```

2.  **Install Servers**: Install servers with automatic configuration.

    ```bash
    # Install the filesystem server
    npx -y @1mcp/agent mcp install filesystem

    # Install specific version
    npx -y @1mcp/agent mcp install git@1.2.0
    ```

3.  **Verify Installation**: Check that servers are properly installed and running.

    ```bash
    npx -y @1mcp/agent mcp list
    npx -y @1mcp/agent mcp status filesystem
    ```

4.  **Manage Updates**: Keep servers updated with latest versions.

    ```bash
    # Check for available updates
    npx -y @1mcp/agent registry search --updates

    # Update specific server
    npx -y @1mcp/agent mcp update filesystem
    ```

5.  **Manage Lifecycle**: Enable, disable, or remove servers as needed.

    ```bash
    # Temporarily disable
    npx -y @1mcp/agent mcp disable filesystem

    # Re-enable
    npx -y @1mcp/agent mcp enable filesystem

    # Remove with backup
    npx -y @1mcp/agent mcp uninstall filesystem
    ```

### Manual Configuration Workflow (Advanced)

For custom servers not available in the registry:

1.  **Add Server Manually**: Configure server details manually.

    ```bash
    npx -y @1mcp/agent mcp add custom-server --type=stdio --command="node server.js"
    ```

2.  **Configure Settings**: Set server-specific options.
    ```bash
    npx -y @1mcp/agent mcp update custom-server --tags=custom,experimental --args="--port=3000"
    ```

The registry-based approach is recommended for most users, with manual configuration reserved for custom or proprietary servers.

## Best Practices

### Configuration

- **Use Descriptive Names**: Give your servers clear, descriptive names.
- **Use Tags for Organization**: Apply a consistent tagging strategy to easily filter and manage your servers. Common tag categories include environment (`dev`, `prod`), function (`database`, `files`), and priority (`critical`, `optional`).
- **Set Appropriate Timeouts**: Configure timeouts based on the expected responsiveness of the server. Local servers can have shorter timeouts than remote ones.

### Security

- **Validate Server Sources**: Only add MCP servers from trusted sources.
- **Manage Secrets**: Use environment variables to pass secrets like API keys to your servers. Avoid hardcoding them in your configuration.
- **Limit Permissions**: Run `stdio` servers with the minimum required permissions.
