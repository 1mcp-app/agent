---
title: MCP 模板语法参考
description: 1MCP 服务器模板中 Handlebars 模板语法的完整参考。变量、辅助函数和渲染规则。
head:
  - ['meta', { name: 'keywords', content: 'Handlebars 语法,模板参考,变量,辅助函数' }]
  - ['meta', { property: 'og:title', content: '1MCP 模板语法参考' }]
  - ['meta', { property: 'og:description', content: '1MCP 服务器模板的完整 Handlebars 语法参考。' }]
---

# 模板语法参考

1MCP 服务器模板中 Handlebars 模板语法的完整参考。

## 语法概述

1MCP 服务器模板使用 [Handlebars](https://handlebarsjs.com/) 语法，变量替换使用双花括号：

::: v-pre

```text
{{variable}}           <!-- 变量访问 -->
{{namespace.variable}}  <!-- 嵌套变量访问 -->
{{helper arg1 arg2}}   <!-- 辅助函数调用 -->
```

:::

## 变量访问

### 标准语法

所有模板变量都使用双花括号：

::: v-pre

```text
{{project.path}}
{{user.username}}
{{context.sessionId}}
{{transport.client.name}}
{{project.custom.teamId}}
```

:::

### 嵌套属性

使用点号表示法访问嵌套属性：

::: v-pre

```text
{{project.git.branch}}
{{project.custom.apiEndpoint}}
{{transport.client.version}}
```

:::

### 可选值

可能未定义的属性将渲染为空字符串：

::: v-pre

```text
{{project.git.branch}}    <!-- 如果不在 git 仓库中则渲染为空 -->
{{user.email}}            <!-- 如果未设置则渲染为空 -->
```

:::

## 模板变量

### 项目变量

| 变量                     | 类型    | 描述                        |
| ------------------------ | ------- | --------------------------- |
| `project.path`           | string  | 当前项目的绝对路径          |
| `project.name`           | string  | 项目目录名称                |
| `project.environment`    | string  | 来自 `.1mcprc` 或默认的环境 |
| `project.git.branch`     | string? | 当前 git 分支               |
| `project.git.commit`     | string? | 当前 git 提交哈希           |
| `project.git.repository` | string? | Git 远程 URL                |
| `project.custom.*`       | any     | 来自 `.1mcprc` 的自定义值   |

### 用户变量

| 变量            | 类型    | 描述            |
| --------------- | ------- | --------------- |
| `user.username` | string? | 系统用户名      |
| `user.name`     | string? | 用户全名        |
| `user.email`    | string? | 用户邮箱地址    |
| `user.home`     | string? | 主目录路径      |
| `user.uid`      | string? | 用户 ID         |
| `user.gid`      | string? | 组 ID           |
| `user.shell`    | string? | 默认 shell 路径 |

### 上下文变量

| 变量                | 类型   | 描述            |
| ------------------- | ------ | --------------- |
| `context.path`      | string | 当前工作目录    |
| `context.timestamp` | string | ISO 8601 时间戳 |
| `context.sessionId` | string | 唯一连接会话 ID |
| `context.version`   | string | 1MCP 版本       |

### 传输变量

| 变量                            | 类型    | 描述                              |
| ------------------------------- | ------- | --------------------------------- |
| `transport.type`                | string  | 传输类型 (`http`、`sse`、`stdio`) |
| `transport.url`                 | string? | 服务器 URL（仅 HTTP/SSE）         |
| `transport.connectionId`        | string? | 连接标识符                        |
| `transport.connectionTimestamp` | string? | 连接时间（ISO 8601）              |
| `transport.client.name`         | string  | 客户端应用名称                    |
| `transport.client.version`      | string  | 客户端应用版本                    |
| `transport.client.title`        | string? | 客户端显示名称                    |

## 条件表达式

### If/Else

::: v-pre

```text

{{#if (eq project.environment 'production')}}
  production-value
{{else if (eq project.environment 'staging')}}
  staging-value
{{else}}
  development-value
{{/if}}
```

:::

### Unless

::: v-pre

```text

{{#unless (eq transport.client.name 'claude-code')}}
  此内容对 claude-code 隐藏
{{/unless}}
```

:::

## 比较辅助函数

### 等于 (`eq`)

::: v-pre

```text

{{#if (eq project.environment 'production')}}
{{/if}}
```

:::

### 不等于 (`ne`)

::: v-pre

```text

{{#if (ne user.username 'root')}}
{{/if}}
```

:::

### 大于 (`gt`)

::: v-pre

```text

{{#if (gt project.custom.count 5)}}
{{/if}}
```

:::

### 小于 (`lt`)

::: v-pre

```text

{{#if (lt project.custom.maxConnections 10)}}
{{/if}}
```

:::

## 逻辑辅助函数

### And

::: v-pre

```text

{{#if (and (eq project.environment 'production') (eq project.custom.region 'us'))}}
{{/if}}
```

:::

### Or

::: v-pre

```text

{{#if (or (eq project.custom.team 'backend') (eq project.custom.team 'devops'))}}
{{/if}}
```

:::

## 数学辅助函数

### 基本数学运算

::: v-pre

```text

{{math value1 '+' value2}}     <!-- 加法 -->
{{math value1 '-' value2}}     <!-- 减法 -->
{{math value1 '*' value2}}     <!-- 乘法 -->
{{math value1 '/' value2}}     <!-- 除法 -->
{{math value1 '%' value2}}     <!-- 取模 -->
{{math value1 '**' value2}}    <!-- 幂运算 -->
```

:::

### 链式运算

::: v-pre

```text

{{math value '*' 100 '/' total}}    <!-- (value * 100) / total，已四舍五入 -->
```

:::

### 专门的数学运算

::: v-pre

```text

{{subtract a b}}    <!-- 带空值安全性的 a - b，未定义时返回 0 -->
{{div a b}}         <!-- 带零安全性的 a / b，除以零时返回 0 -->
```

:::

## 字符串辅助函数

### 包含

::: v-pre

```text

{{#if (contains project.name 'admin')}}
  包含 'admin'
{{/if}}
```

:::

### 以...开头

::: v-pre

```text

{{#if (startsWith project.git.branch 'feature/'))}}
  功能分支
{{/if}}
```

:::

### 以...结尾

::: v-pre

```text

{{#if (endsWith project.name '-test'))}}
  测试项目
{{/if}}
```

:::

### 长度

::: v-pre

```text

{{len project.name}}    <!-- 字符串长度 -->
```

:::

### 子字符串

::: v-pre

```text

{{substring project.name 0 5}}    <!-- 字符 0-4 -->
{{substring project.name 3}}      <!-- 从字符 3 到结尾 -->
```

:::

## 上下文数据结构

### TypeScript 接口

```typescript
interface ContextData {
  project: {
    path: string;
    name: string;
    environment?: string;
    git?: {
      branch?: string;
      commit?: string;
      repository?: string;
    };
    custom?: Record<string, unknown>;
  };
  user: {
    username?: string;
    name?: string;
    email?: string;
    home?: string;
    uid?: string;
    gid?: string;
    shell?: string;
  };
  context: {
    path: string;
    timestamp: string;
    sessionId: string;
    version: string;
  };
  transport?: {
    type: string;
    url?: string;
    connectionId?: string;
    connectionTimestamp?: string;
    client?: {
      name: string;
      version: string;
      title?: string;
    };
  };
}
```

## 模板渲染过程

1MCP 通过五个步骤的工作流程处理模板：

### 步骤 1：上下文收集

当客户端连接时，1MCP 从以下位置收集上下文：

- 当前工作目录（项目路径、名称）
- Git 仓库（分支、提交、远程）
- `.1mcprc` 文件（自定义上下文、环境）
- 系统信息（用户详细信息）
- 连接详细信息（传输、客户端信息）

### 步骤 2：模板查找

1MCP 从 `mcp.json` 的 `mcpTemplates` 中查找与客户端的过滤条件（标签、预设）匹配的模板。

### 步骤 3：变量替换

::: v-pre

通过替换以下内容来渲染每个模板配置：

- `{{variable}}` 占位符替换为实际值
- `{{#if}}` 条件被评估
- `{{helper}}` 函数被执行

:::

### 步骤 4：验证

如果启用了 `validateOnReload`，则根据 MCP 服务器架构验证渲染后的配置。

### 步骤 5：服务器创建

使用渲染后的配置创建服务器实例并将其连接到客户端。

### 缓存

当启用 `cacheContext` 时（默认），渲染后的模板按上下文哈希缓存，以避免重新处理相同的上下文。

## 错误处理

### 模板语法错误

如果模板具有无效的 Handlebars 语法：

- **严格模式**：服务器启动失败，记录错误
- **优雅模式**：使用原始模板而不进行渲染，记录错误

### 缺失变量

::: v-pre

上下文中不存在的变量将渲染为空字符串。这是可选值（如 `{{project.git.branch}}`）的预期行为。

:::

### 验证错误

如果渲染后的配置验证失败：

- **严格模式**：不创建模板服务器
- **优雅模式**：使用原始模板配置

## 示例

### 环境特定配置

::: v-pre

```json
{
  "mcpTemplates": {
    "adaptive-server": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "NODE_ENV": "{{project.environment}}",
        "LOG_LEVEL": "{{#if (eq project.environment 'production')}}warn{{else}}debug{{/if}}",
        "FEATURE_FLAG_X": "{{#if (gt project.custom.version 2)}}true{{else}}false{{/if}}"
      }
    }
  }
}
```

:::

### 客户端感知配置

::: v-pre

```json
{
  "mcpTemplates": {
    "client-specific": {
      "command": "npx",
      "args": ["-y", "my-server", "--client", "{{transport.client.name}}", "--version", "{{transport.client.version}}"],
      "disabled": "{{#if (or (eq transport.client.name 'cursor') (eq transport.client.name 'claude-code'))}}false{{else}}true{{/if}}"
    }
  }
}
```

:::

### Git 感知配置

::: v-pre

```json
{
  "mcpTemplates": {
    "branch-aware": {
      "command": "npx",
      "args": ["-y", "context-server", "{{project.path}}", "--branch", "{{project.git.branch}}"],
      "disabled": "{{#if (startsWith project.git.branch 'hotfix/')}}true{{else}}false{{/if}}"
    }
  }
}
```

:::

## 另请参阅

- **[MCP 服务器模板指南](/zh/guide/mcp-server-templates)** - 使用模板的完整指南
- **[Handlebars 文档](https://handlebarsjs.com/)** - 官方 Handlebars 参考
- **[上下文增强](/zh/guide/mcp-server-templates#上下文增强-1mcprc)** - 使用 `.1mcprc` 文件
