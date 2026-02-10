---
title: Serena 集成 - 使用 MCP 模板进行语义代码分析
description: 学习如何将 Serena（语义代码分析 MCP 服务器）与 1MCP 的模板系统结合使用，实现动态的、项目感知的语义代码理解。
head:
  - ['meta', { name: 'keywords', content: 'Serena,语义分析,MCP 模板,代码分析,LSP,符号分析' }]
  - ['meta', { property: 'og:title', content: 'Serena 与 1MCP 模板集成' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: '使用 1MCP 模板配置 Serena 语义代码分析，实现项目感知的上下文驱动工作流。',
      },
    ]
---

# Serena 集成

> **🧠 语义智能**: 利用 Serena 强大的语义代码分析能力与 1MCP 的动态模板系统，实现项目感知的工作流

## 概述

[Serena](https://github.com/oraios/serena) 是一个语义代码分析工具包，提供基于 LSP 的代码库理解能力。它支持符号级操作、交叉引用分析和智能代码导航，覆盖 30 多种编程语言。

### 为什么将 Serena 与 1MCP 模板结合使用？

<ClientOnly>

将 Serena 与 1MCP 的模板系统结合可以实现：

- **自动项目检测**: 模板通过 <span v-pre>`{{project.path}}`</span> 动态注入项目路径
- **上下文感知配置**: 根据客户端类型（IDE vs CLI）提供不同的工具集
- **基于环境的控制**: 在开发环境中启用语义分析，在生产环境中禁用
- **零手动配置**: 项目上下文从 1MCP 自动流向 Serena

</ClientOnly>

### 主要功能

- **符号级操作**: 查找、引用、重命名和操作代码符号
- **多语言支持**: Python、TypeScript、Java、Rust、Go、C/C++ 等 30 多种语言
- **LSP 驱动分析**: 利用语言服务器协议实现准确理解
- **项目索引**: 为大型代码库提供快速符号查找
- **Web 仪表板**: 在 `http://localhost:24282/dashboard` 进行可视化项目探索

## 快速开始

### 基本静态配置

使用固定项目路径将 Serena 添加到 `mcp.json`：

::: v-pre

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "/absolute/path/to/your/project",
        "--context",
        "claude-code"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

### 基于模板的配置（推荐）

使用模板实现自动项目检测：

::: v-pre

```json
{
  "mcpTemplates": {
    "project-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "claude-code"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**工作原理**: 当客户端连接时，1MCP 自动：

1. 检测当前项目目录
2. 使用实际路径渲染 <span v-pre>`{{project.path}}`</span>
3. 启动为该特定项目配置的 Serena
4. 提供项目感知的语义分析工具

## 模板变量

### 项目路径注入

<ClientOnly>

Serena 需要项目根目录进行分析。使用 <span v-pre>`{{project.path}}`</span> 自动注入：

::: v-pre

```json
{
  "mcpTemplates": {
    "auto-project-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}"
      ]
    }
  }
}
```

:::

</ClientOnly>

### 实例共享

**重要**: 当渲染的模板配置相同时，1MCP 会自动共享同一个 Serena 实例。这意味着：

- **在同一台机器上**使用**相同上下文**在**同一项目**上工作的多个 AI 客户端/会话共享一个 Serena 实例
- 每个唯一的项目路径获得自己的专用 Serena 实例
- 不同的上下文（例如 `claude-code` vs `ide`）获得独立的实例

**示例**: 如果您在开发机器上打开多个终端窗口运行 Claude Code CLI，所有连接到同一项目，它们共享一个带有 `claude-code` 上下文的 Serena 实例。如果您随后在同一台机器上打开 Cursor 处理同一项目，它会获得一个独立的带有 `ide` 上下文的实例。

**注意**: Serena 需要本地文件访问权限来读取代码、配置和缓存文件。即使在同一项目上工作，每位开发者在自己的机器上都会有自己的 Serena 实例。

**优势**:

- **资源效率**: 减少本地机器的内存和 CPU 使用
- **共享符号索引**: 首次 AI 客户端连接后分析更快
- **一致状态**: 同一台机器上的所有 AI 客户端看到相同的语义理解

## 上下文感知配置

Serena 的 `--context` 参数根据客户端类型控制可用的工具。使用模板条件选择适当的上下文：

### 可用的上下文类型

| 上下文        | 用例                | 可用工具                        |
| ------------- | ------------------- | ------------------------------- |
| `claude-code` | Claude Code CLI     | 优化的工具集，禁用 IDE 冗余功能 |
| `ide`         | VSCode、Cursor、IDE | 减少工具以避免与 IDE 功能重复   |
| `codex`       | Codex CLI           | Codex 兼容性所需                |
| 自定义        | 用户定义            | 通过 Serena 配置系统创建        |

### 客户端感知上下文选择

根据连接的客户端自动选择上下文：

::: v-pre

```json
{
  "mcpTemplates": {
    "smart-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "{{#if (eq transport.client.name 'cursor')}}ide{{else}}claude-code{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**工作原理**:

- Cursor 或 VSCode 客户端获得 `ide` 上下文（避免工具重复）
- 所有其他客户端获得 `claude-code` 上下文（完整工具集）

### 多客户端上下文映射

使用复杂条件处理多个 IDE 客户端：

::: v-pre

```json
{
  "mcpTemplates": {
    "client-aware-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "{{#if (or (eq transport.client.name 'cursor') (eq transport.client.name 'vscode'))}}ide{{else}}claude-code{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

## 项目级配置

### 使用 .1mcprc 自定义上下文

在 `.1mcprc` 中定义自定义元数据并在模板中引用：

**项目根目录中的 .1mcprc：**

::: v-pre

```json
{
  "preset": "dev-tools",
  "tags": ["backend", "python"],
  "context": {
    "projectId": "myapp-backend",
    "environment": "development",
    "custom": {
      "serenaContext": "claude-code",
      "enableDashboard": true
    }
  }
}
```

:::

**使用自定义上下文的模板：**

::: v-pre

```json
{
  "mcpTemplates": {
    "custom-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "{{project.custom.serenaContext}}",
        "--open-web-dashboard",
        "{{project.custom.enableDashboard}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

### Serena 自身的配置

Serena 维护独立于 1MCP 模板的配置：

- **全局配置**: `~/.serena/serena_config.yml`
- **项目配置**: `.serena/project.yml`（通过 `serena project create` 创建）

**设置 Serena 项目配置：**

```bash
# 导航到项目
cd /path/to/your/project

# 使用索引初始化 Serena 项目
serena project create --index

# 这将创建包含项目特定设置的 .serena/project.yml
```

**重要**: 1MCP 模板配置 Serena 服务器实例（CLI 参数），而 Serena 的配置文件控制分析行为（索引首选项、语言设置）。

## 完整示例

### 示例 1：多环境设置

在开发环境中启用语义分析，在生产环境中禁用：

::: v-pre

```json
{
  "mcpTemplates": {
    "env-aware-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "claude-code"
      ],
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}",
      "tags": ["filesystem", "search", "semantic", "development"]
    }
  }
}
```

:::

**用例**: 防止在生产环境中进行资源密集型语义分析，同时在开发环境中保持可用。

### 示例 2：仪表板控制

根据环境控制 Web 仪表板：

::: v-pre

```json
{
  "mcpTemplates": {
    "dashboard-controlled-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "claude-code",
        "--open-web-dashboard",
        "{{#if (eq project.environment 'development')}}true{{else}}false{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**用例**: 在开发环境中自动启动 Web 仪表板进行可视化探索，但在 CI/CD 或生产环境中禁用。

### 示例 3：语言后端选择

为特定项目使用 JetBrains 语言后端：

::: v-pre

```json
{
  "mcpTemplates": {
    "jetbrains-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "{{#if (eq transport.client.name 'cursor')}}ide{{else}}claude-code{{/if}}",
        "--language-backend",
        "{{#if project.custom.useJetBrains}}JetBrains{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**用例**: 高级项目可以通过自定义元数据选择使用基于 JetBrains 插件的语言支持。

### 示例 4：HTTP 传输与自定义端口

通过 HTTP 运行 Serena 以实现远程访问：

::: v-pre

```json
{
  "mcpTemplates": {
    "http-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--context",
        "claude-code",
        "--transport",
        "streamable-http",
        "--port",
        "{{#if project.custom.serenaPort}}{{project.custom.serenaPort}}{{else}}24283{{/if}}"
      ],
      "tags": ["filesystem", "search", "semantic"]
    }
  }
}
```

:::

**用例**: 远程访问场景或需要通过 HTTP 而不是 STDIO 暴露 Serena。

## 最佳实践

### 1. 使用 `--project` 与模板

始终动态注入项目路径：

✅ **正确**:
::: v-pre

```json
"args": ["serena", "start-mcp-server", "--project", "{{project.path}}"]
```

:::

❌ **错误**:

```json
"args": ["serena", "start-mcp-server", "--project", "/hardcoded/path"]
```

### 2. 选择正确的上下文

根据客户端类型匹配上下文：

| 客户端类型      | 推荐上下文       |
| --------------- | ---------------- |
| Claude Code CLI | `claude-code`    |
| Cursor、VSCode  | `ide`            |
| Codex CLI       | `codex`          |
| 自定义代理      | 创建自定义上下文 |

### 3. 适当标记

始终包含语义分析标签：

::: v-pre

```json
{
  "tags": ["filesystem", "search", "semantic"]
}
```

:::

这使得可以使用预设进行适当的服务器过滤。

### 4. 不使用环境变量

**重要**: Serena 不使用环境变量进行配置。所有设置必须通过以下方式传递：

- CLI 参数（例如 `--project`、`--context`）
- 配置文件（`serena_config.yml`、`.serena/project.yml`）

❌ **错误**:

```json
{
  "env": {
    "SERENA_PROJECT": "{{project.path}}" // Serena 会忽略这个
  }
}
```

✅ **正确**:

```json
{
  "args": ["--project", "{{project.path}}"] // 使用 CLI 参数
}
```

:::

### 5. 基于环境的禁用

使用 `disabled` 字段根据环境控制 Serena：

::: v-pre

```json
{
  "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}"
}
```

:::

### 6. 项目设置

为了获得最佳性能，在项目中初始化 Serena：

```bash
cd /path/to/your/project
serena project create --index
```

这将创建 `.serena/project.yml` 并构建初始符号索引。

### 7. 客户端感知选择

<ClientOnly>

利用 <span v-pre>`{{transport.client.name}}`</span> 进行智能上下文选择：

::: v-pre

```json
{
  "args": ["--context", "{{#if (eq transport.client.name 'cursor')}}ide{{else}}claude-code{{/if}}"]
}
```

:::

</ClientOnly>

## Serena 特定功能

### 符号级操作

Serena 提供强大的语义工具：

- **`find_symbol`**: 按名称或模式定位类、函数、方法
- **`find_referencing_symbols`**: 查找符号的所有引用
- **`get_symbols_overview`**: 获取高级代码结构
- **`replace_symbol_body`**: 修改符号定义
- **`insert_after_symbol`**: 在符号后添加代码
- **`insert_before_symbol`**: 在符号前添加代码
- **`rename_symbol`**: 在代码库中重命名符号

### 语言支持

Serena 通过 LSP 支持 30 多种语言，包括：

- **Web**: TypeScript、JavaScript、HTML、CSS
- **后端**: Python、Java、Go、Rust、C/C++、C#
- **移动**: Swift、Kotlin、Dart
- **数据**: SQL、R、Julia
- **配置**: YAML、JSON、TOML

### 项目索引

对于大型项目，构建索引以实现更快的符号查找：

```bash
# 一次性索引
serena project index

# 或在项目创建期间
serena project create --index
```

### Web 仪表板

Serena 在 `http://localhost:24282/dashboard` 自动启动 Web 仪表板以进行可视化代码探索。

**禁用仪表板**:

```json
{
  "args": ["--open-web-dashboard", "false"]
}
```

:::

### 上下文系统

不同的上下文提供不同的工具集：

- **`claude-code`**: CLI 代理的完整语义工具包
- **`ide`**: 最少的工具以避免 IDE 重复
- **`codex`**: Codex 兼容的工具配置

通过 `~/.serena/serena_config.yml` 创建自定义上下文。

## 故障排除

<ClientOnly>

### 模板变量未渲染

**症状**: Serena 使用字面量 `{{project.path}}` 而不是实际路径启动

**解决方案**: 确保使用 `mcpTemplates` 而不是 `mcpServers`：

::: v-pre

```json
{
  "mcpTemplates": {  // ← 必须是模板，不是服务器
    "serena": { ... }
  }
}
```

:::

### Serena 找不到项目根目录

**症状**: Serena 报告"未找到项目"或"无效的项目路径"

**解决方案**:

1. 如果代理从项目目录启动，使用 `--project-from-cwd`
2. 验证 <span v-pre>`{{project.path}}`</span> 正确解析
3. 初始化项目：在项目根目录运行 `serena project create`

</ClientOnly>

### 上下文参数不起作用

**症状**: 可用工具错误或上下文参数被忽略

**解决方案**:

1. 验证上下文名称有效：`claude-code`、`ide`、`codex` 或自定义
2. 检查模板条件逻辑中的拼写错误
3. 确保在 `~/.serena/serena_config.yml` 中定义了自定义上下文

### 大型项目的性能问题

**症状**: 符号查找缓慢、内存使用率高

**解决方案**:

1. 构建符号索引：`serena project index`
2. 使用 `.serenignore` 排除不必要的目录（node_modules、build 等）
3. 考虑在大型代码库上使用 `--language-backend JetBrains` 以获得更好的性能

### 仪表板未打开

**症状**: Web 仪表板不会自动启动

**解决方案**:

1. 检查端口 24282 是否已被占用
2. 手动打开：`http://localhost:24282/dashboard`
3. 禁用自动启动：`--open-web-dashboard false`

## 另请参阅

- [MCP 服务器模板指南](/zh/guide/mcp-server-templates) - 模板系统完整指南
- [模板语法参考](/zh/reference/mcp-templates/syntax) - Handlebars 语法和助手
- [配置指南](/zh/guide/essentials/configuration) - 配置和 .1mcprc 设置
- [Claude Desktop 集成](/zh/guide/integrations/claude-desktop) - 将 Serena 与 Claude Desktop 配合使用
- [开发者工具](/zh/guide/integrations/developer-tools) - 集成功能和 API
- [Serena 文档](https://oraios.github.io/serena/) - Serena 官方文档
- [Serena GitHub](https://github.com/oraios/serena) - 源代码和问题
