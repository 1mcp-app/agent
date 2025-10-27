---
title: 服务器管理指南 - 传输类型和最佳实践
description: 了解如何在 1MCP 中管理 MCP 服务器。涵盖 STDIO 和 HTTP 传输、配置最佳实践和生命周期管理。
head:
  - ['meta', { name: 'keywords', content: 'MCP 服务器管理,传输类型,STDIO 传输,HTTP 传输' }]
  - ['meta', { property: 'og:title', content: '1MCP 服务器管理指南' }]
  - ['meta', { property: 'og:description', content: '在 1MCP 中管理 MCP 服务器的完整指南。传输类型和最佳实践。' }]
---

# 服务器管理指南

本指南详细概述了在您的 1MCP 实例中管理 MCP 服务器。它涵盖了传输类型、配置最佳实践和高级管理工作流程。

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
- **自定义标头**：为身份验证或其他目的添加自定义 HTTP 标头。
- **连接池**：高效管理到远程服务器的连接。

### SSE 传输（已弃用）

服务器发送事件是一种已弃用的传输类型。建议改用 HTTP 传输。

## 服务器配置详细信息

您在 1MCP 中定义的每个服务器都有一组通用的配置选项：

- **名称**：服务器的唯一、人类可读的名称（例如 `my-git-server`）。
- **传输**：传输类型（`stdio` 或 `http`）。
- **命令/URL**：为 `stdio` 传输执行的命令，或为 `http` 传输执行的 URL。
- **参数**：`stdio` 服务器的命令行参数数组。
- **环境**：`stdio` 服务器的环境变量键值对。
- **标签**：用于组织和筛选服务器的标签列表。
- **超时**：连接超时（以毫秒为单位）。
- **启用/禁用**：一个标志，用于启用或禁用服务器，而无需删除其配置。

## 服务器管理工作流程

管理服务器的典型工作流程如下所示：

1.  **添加服务器**：向您的 1MCP 实例添加新服务器。
    ```bash
    # 添加本地 git 服务器
    npx -y @1mcp/agent mcp add git-main --type=stdio --command="mcp-server-git" --args="--repository ."
    ```
2.  **验证配置**：列出您的服务器并检查新服务器的状态。
    ```bash
    ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent mcp list
    npx -y @1mcp/agent mcp status git-main
    ```
3.  **根据需要更新**：修改服务器的配置。例如，添加一个标签。
    ```bash
    npx -y @1mcp/agent mcp update git-main --tags=source-control,project-a
    ```
4.  **管理其生命周期**：如果您需要暂时禁用服务器，可以在不丢失其配置的情况下执行此操作。
    ```bash
    npx -y @1mcp/agent mcp disable git-main
    # ...稍后...
    npx -y @1mcp/agent mcp enable git-main
    ```
5.  **完成后删除**：如果您不再需要该服务器，可以永久删除它。
    ```bash
    npx -y @1mcp/agent mcp remove git-main
    ```

## 最佳实践

### 配置

- **使用描述性名称**：为您的服务器提供清晰、描述性的名称。
- **使用标签进行组织**：应用一致的标记策略，以轻松筛选和管理您的服务器。常见的标签类别包括环境（`dev`、`prod`）、功能（`database`、`files`）和优先级（`critical`、`optional`）。
- **设置适当的超时**：根据服务器的预期响应能力配置超时。本地服务器的超时时间可以比远程服务器短。

### 安全

- **验证服务器来源**：仅添加来自受信任来源的 MCP 服务器。
- **管理机密**：使用环境变量将 API 密钥等机密传递给您的服务器。避免在配置中对它们进行硬编码。
- **限制权限**：以最低要求的权限运行 `stdio` 服务器。
