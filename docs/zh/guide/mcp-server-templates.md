---
title: MCP 服务器模板 - 动态服务器配置
description: 参考 MCP 服务器模板语法及当前默认拒绝的上下文安全约定。
head:
  - ['meta', { name: 'keywords', content: 'MCP 服务器模板,Handlebars,动态配置,上下文感知' }]
  - ['meta', { property: 'og:title', content: '1MCP 服务器模板指南' }]
  - ['meta', { property: 'og:description', content: '使用模板和上下文变量实现动态 MCP 服务器配置。' }]
---

# MCP 服务器模板

MCP 服务器模板定义基于 Handlebars 的上下文感知服务器配置语法。模板定义可以存入配置，但此版本没有可用于渲染并创建模板服务器的可信生产上下文来源。

::: warning 公网上下文不能创建模板服务器
在此版本中，公开客户端提供的 `_meta.context`（包括 REST 请求体）、查询参数中的 `context`、`1mcp proxy` 携带的上下文，以及持久化的 HTTP 上下文，在渲染模板的 `command`、`args`、`cwd` 或 `env` 时都会被忽略。通过这些公开入口创建模板的能力暂时不可用，需等待经过认证的服务端上下文设计。
:::

## 概述

此配置格式用于表达：

- **动态服务器创建**：根据项目上下文定义不同服务器
- **环境感知配置**：按环境选择设置
- **上下文增强**：在服务器配置中引用项目元数据
- **条件启用**：按运行时条件启用或禁用服务器

### 模板与静态服务器

1MCP 支持两种类型的服务器配置：

| 功能       | 静态服务器 (`mcpServers`) | 模板服务器 (`mcpTemplates`) |
| ---------- | ------------------------- | --------------------------- |
| 配置       | 启动时固定值              | 基于上下文的模板值                    |
| 上下文感知 | 无                        | 项目、用户、传输、客户端语法          |
| 多实例     | 每个配置一个实例          | 此版本无法通过公开上下文创建          |
| 生命周期   | 始终运行                  | 此版本没有公开创建路径                |
| 用例       | 稳定的基础设施            | 未来经过认证的服务端上下文集成        |

### 与指令模板的关键区别

**MCP 服务器模板** (`mcpTemplates`) 使用动态值配置服务器实例，例如：

- <span v-pre>`{{project.path}}`</span> - 项目目录路径
- <span v-pre>`{{user.username}}`</span> - 当前用户

**指令模板**使用变量自定义 LLM 指令，例如：

- <span v-pre>`{{serverCount}}`</span> - 连接的服务器数量
- <span v-pre>`{{serverNames}}`</span> - 服务器名称列表

## 语法示例

### 基本模板示例

将模板添加到您的 `mcp.json`：

::: v-pre

```json
{
  "mcpTemplates": {
    "project-context": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{project.path}}"],
      "tags": ["filesystem", "project"]
    }
  }
}
```

:::

这只会记录模板定义。在此版本中，公开客户端连接不会提供渲染权限、不会渲染占位符，也不会创建服务器实例。

### 环境特定配置

::: v-pre

```json
{
  "mcpTemplates": {
    "conditional-server": {
      "command": "node",
      "args": ["{{project.path}}/server.js"],
      "env": {
        "NODE_ENV": "{{project.environment}}",
        "DEBUG": "{{#if (eq project.environment 'development')}}true{{else}}false{{/if}}"
      },
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}",
      "tags": ["development"]
    }
  }
}
```

:::

## 模板变量

模板语法为未来的可信上下文来源定义了四个上下文变量命名空间：

### 项目变量 (`project.*`)

| 变量                     | 类型    | 描述                      | 示例                           |
| ------------------------ | ------- | ------------------------- | ------------------------------ |
| `project.path`           | string  | 当前项目的绝对路径        | `/Users/dev/myapp`             |
| `project.name`           | string  | 项目目录名称              | `myapp`                        |
| `project.environment`    | string  | 环境名称                  | `development`                  |
| `project.git.branch`     | string? | Git 分支名称              | `main`                         |
| `project.git.commit`     | string? | Git 提交哈希              | `a1b2c3d`                      |
| `project.git.repository` | string? | Git 远程 URL              | `https://github.com/user/repo` |
| `project.custom.*`       | any     | 来自 `.1mcprc` 的自定义值 | 用户定义                       |

### 用户变量 (`user.*`)

| 变量            | 类型    | 描述       | 示例               |
| --------------- | ------- | ---------- | ------------------ |
| `user.username` | string? | 系统用户名 | `developer`        |
| `user.name`     | string? | 用户全名   | `Jane Developer`   |
| `user.email`    | string? | 用户邮箱   | `jane@example.com` |
| `user.home`     | string? | 主目录路径 | `/Users/developer` |
| `user.uid`      | string? | 用户 ID    | `501`              |
| `user.gid`      | string? | 组 ID      | `20`               |
| `user.shell`    | string? | 默认 shell | `/bin/zsh`         |

### 传输变量 (`transport.*`)

| 变量                            | 类型    | 描述                  | 示例                    |
| ------------------------------- | ------- | --------------------- | ----------------------- |
| `transport.type`                | string  | 传输协议              | `http`、`sse`、`stdio`  |
| `transport.url`                 | string? | 服务器 URL (HTTP/SSE) | `http://localhost:3050` |
| `transport.connectionId`        | string? | 连接标识符            | `conn_xyz789`           |
| `transport.connectionTimestamp` | string? | 连接时间              | `2025-01-25T10:30:00Z`  |
| `transport.client.name`         | string  | 客户端应用名称        | `cursor`、`claude-code` |
| `transport.client.version`      | string  | 客户端版本            | `1.0.0`                 |
| `transport.client.title`        | string? | 客户端显示名称        | `Cursor Editor`         |

## 模板语法

1MCP 使用 [Handlebars](https://handlebarsjs.com/) 进行模板渲染。变量使用双花括号：<span v-pre>`{{variable}}`</span>。

### 变量访问

::: v-pre

```text
{{project.path}}              <!-- /Users/dev/project -->
{{user.username}}             <!-- developer -->
{{transport.client.name}}     <!-- cursor -->
{{project.custom.teamId}}     <!-- 来自 .1mcprc 的自定义值 -->
```

:::

### 条件语句

::: v-pre

使用 `{{#if}}` 进行条件逻辑：

```text
{{#if (eq project.environment 'production')}}
  <!-- 生产环境配置 -->
{{else}}
  <!-- 开发环境配置 -->
{{/if}}
```

:::

### 比较运算

使用内置辅助函数进行比较：

::: v-pre

```text
{{#if (eq project.environment 'development')}}{{/if}}
{{#if (ne user.username 'root')}}{{/if}}
{{#if (gt project.custom.count 5)}}{{/if}}
{{#if (lt transport.client.version '2.0')}}{{/if}}
```

:::

### 逻辑运算符

使用 `and`/`or` 组合条件：

::: v-pre

```text
{{#if (and (eq project.environment 'production') (eq project.custom.region 'us'))}}
{{/if}}

{{#if (or (eq project.custom.team 'backend') (eq project.custom.team 'devops'))}}
{{/if}}
```

:::

### 字符串操作

::: v-pre

```text
{{#if (contains project.name 'admin')}}
{{/if}}

{{#if (startsWith project.git.branch 'feature/')}}
{{/if}}

{{#if (endsWith project.name '-test')}}
{{/if}}
```

:::

## 上下文增强 (.1mcprc)

此语法可以引用项目级元数据。`.1mcprc` 文件可以记录这些元数据，但此版本不会使用它通过公开客户端入口携带的上下文渲染模板：

```json
{
  "preset": "my-team-preset",
  "tags": ["team-a", "backend"],
  "context": {
    "projectId": "myapp-backend",
    "environment": "development",
    "team": "platform",
    "custom": {
      "teamId": "team-a",
      "region": "us-west",
      "debugMode": true,
      "apiEndpoint": "https://dev-api.example.com"
    },
    "envPrefixes": ["MYAPP_*", "TEAM_*"],
    "includeGit": true,
    "sanitizePaths": true
  }
}
```

### 上下文字段

| 字段                    | 类型             | 描述                                         |
| ----------------------- | ---------------- | -------------------------------------------- |
| `preset`                | string           | 默认使用的预设                               |
| `tags`                  | string\|string[] | 用于过滤的默认标签                           |
| `context.projectId`     | string           | 项目标识符                                   |
| `context.environment`   | string           | 环境名称（development、staging、production） |
| `context.team`          | string           | 团队名称                                     |
| `context.custom`        | object           | 自定义键值对                                 |
| `context.envPrefixes`   | string[]         | 要包含的环境变量前缀                         |
| `context.includeGit`    | boolean          | 是否包含 Git 信息                            |
| `context.sanitizePaths` | boolean          | 是否清理文件路径以确保安全                   |

### 访问自定义上下文

自定义值可以作为 <span v-pre>`{{project.custom.*}}`</span> 访问：

::: v-pre

```json
{
  "mcpTemplates": {
    "team-server": {
      "command": "npx",
      "args": ["-y", "serena", "{{project.path}}"],
      "env": {
        "TEAM_ID": "{{project.custom.teamId}}",
        "REGION": "{{project.custom.region}}",
        "API_ENDPOINT": "{{project.custom.apiEndpoint}}",
        "DEBUG": "{{#if project.custom.debugMode}}true{{else}}false{{/if}}"
      },
      "tags": ["{{project.custom.team}}"]
    }
  }
}
```

:::

## 完整示例

以下是一个综合模板配置：

::: v-pre

```json
{
  "$schema": "https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json",
  "version": "1.0.0",
  "templateSettings": {
    "validateOnReload": true,
    "failureMode": "graceful",
    "cacheContext": true
  },
  "mcpTemplates": {
    "project-filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{project.path}}"],
      "tags": ["filesystem", "project-local"],
      "disabled": "{{#if (eq transport.client.name 'claude-code')}}false{{else}}true{{/if}}"
    },
    "team-serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--project",
        "{{project.path}}",
        "--team",
        "{{project.custom.team}}",
        "--env",
        "{{project.environment}}"
      ],
      "env": {
        "PROJECT_ID": "{{project.custom.projectId}}",
        "GIT_BRANCH": "{{project.git.branch}}",
        "API_ENDPOINT": "{{project.custom.apiEndpoint}}"
      },
      "cwd": "{{project.path}}",
      "tags": ["filesystem", "search"]
    },
    "conditional-debug-server": {
      "command": "node",
      "args": ["{{project.path}}/debug-server.js"],
      "cwd": "{{project.path}}",
      "env": {
        "NODE_ENV": "{{project.environment}}",
        "DEBUG": "{{#if (eq project.environment 'development')}}true{{else}}false{{/if}}",
        "LOG_LEVEL": "{{#if (eq project.environment 'production')}}warn{{else}}debug{{/if}}"
      },
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}",
      "tags": ["debug", "development"]
    },
    "client-aware-server": {
      "command": "npx",
      "args": [
        "-y",
        "my-custom-server",
        "--client",
        "{{transport.client.name}}",
        "--version",
        "{{transport.client.version}}"
      ],
      "env": {
        "CLIENT_NAME": "{{transport.client.name}}",
        "CLIENT_VERSION": "{{transport.client.version}}",
        "CONNECTION_ID": "{{transport.connectionId}}",
        "USER": "{{user.username}}"
      },
      "tags": ["client-aware", "custom"]
    }
  }
}
```

:::

## 模板设置

使用 `templateSettings` 控制模板处理行为：

```json
{
  "templateSettings": {
    "validateOnReload": true,
    "failureMode": "graceful",
    "cacheContext": true
  }
}
```

| 设置               | 类型                   | 默认值     | 描述                       |
| ------------------ | ---------------------- | ---------- | -------------------------- |
| `validateOnReload` | boolean                | `false`    | 保留供将来使用；当前无效果 |
| `failureMode`      | `'strict'\|'graceful'` | `'strict'` | 如何处理模板错误           |
| `cacheContext`     | boolean                | `true`     | 按上下文哈希缓存渲染的模板 |

### 失败模式

- **`strict`**：模板错误会导致受影响的模板服务器被跳过；错误会被记录。其他服务器正常继续。
- **`graceful`**：模板错误会被记录，使用原始模板作为回退

## 条件禁用

可以使用 `disabled` 字段有条件地禁用模板：

::: v-pre

```json
{
  "mcpTemplates": {
    "dev-only-server": {
      "command": "node",
      "args": ["dev-tools.js"],
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}",
      "tags": ["development"]
    },
    "client-specific": {
      "command": "npx",
      "args": ["-y", "special-server"],
      "disabled": "{{#if (eq transport.client.name 'cursor')}}false{{else}}true{{/if}}",
      "tags": ["cursor-only"]
    },
    "user-restricted": {
      "command": "npx",
      "args": ["-y", "admin-tools"],
      "disabled": "{{#if (contains user.username 'admin')}}false{{else}}true{{/if}}",
      "tags": ["admin"]
    }
  }
}
```

:::

`disabled` 字段评估模板并将结果转换为布尔值：

- `"true"`、`"1"`、`"yes"` → `true`（已禁用）
- `"false"`、`"0"`、`"no"` 或空值 → `false`（已启用）

## Handlebars 辅助函数

1MCP 包含多个内置 Handlebars 辅助函数：

### 数学辅助函数

::: v-pre

```text
{{math value1 '+' value2}}           <!-- 加法 -->
{{math value1 '-' value2}}           <!-- 减法 -->
{{math value1 '*' value2}}           <!-- 乘法 -->
{{math value1 '/' value2}}           <!-- 除法 -->
{{math value1 '%' value2}}           <!-- 取模 -->
{{math value1 '**' value2}}          <!-- 幂运算 -->
{{math value '/' 100 '*' 100}}       <!-- 链式运算（已四舍五入） -->
```

:::

### 比较辅助函数

::: v-pre

```text
{{eq a b}}     <!-- 等于 -->
{{ne a b}}     <!-- 不等于 -->
{{gt a b}}     <!-- 大于 -->
{{lt a b}}     <!-- 小于 -->
```

:::

### 逻辑辅助函数

::: v-pre

```text
{{and a b c}}  <!-- 全部为真 -->
{{or a b c}}   <!-- 任一为真 -->
```

:::

### 字符串辅助函数

::: v-pre

```text
{{contains str substring}}     <!-- 包含子字符串 -->
{{startsWith str prefix}}      <!-- 以前缀开头 -->
{{endsWith str suffix}}        <!-- 以后缀结尾 -->
{{len str}}                    <!-- 字符串长度 -->
{{substring str start end}}    <!-- 提取子字符串 -->
```

:::

### 数学运算辅助函数

::: v-pre

```text
{{subtract a b}}    <!-- 带空值安全性的 a - b -->
{{div a b}}         <!-- 带零安全性的 a / b -->
```

:::

## 最佳实践

### 1. 不要依赖公开 .1mcprc 上下文进行渲染

下面的结构用于说明预期元数据格式。它不会使 `.1mcprc` 上下文变为可信，也不会通过 `proxy` 或公开 HTTP 激活模板创建：

**推荐**（`.1mcprc`）：

```json
{
  "context": {
    "projectId": "myapp-api",
    "team": "platform",
    "custom": {
      "apiEndpoint": "https://api.example.com"
    }
  }
}
```

**避免**（硬编码）：

```json
{
  "mcpTemplates": {
    "api-server": {
      "env": {
        "API_ENDPOINT": "https://api.example.com"
      }
    }
  }
}
```

### 2. 使模板支持环境感知

使用 `project.environment` 实现环境特定的行为：

::: v-pre

```json
{
  "mcpTemplates": {
    "smart-server": {
      "env": {
        "LOG_LEVEL": "{{#if (eq project.environment 'production')}}warn{{else}}debug{{/if}}",
        "CACHE_ENABLED": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}"
      }
    }
  }
}
```

:::

### 3. 使用 validateOnReload 验证

在开发期间启用模板验证：

::: v-pre

```json
{
  "templateSettings": {
    "validateOnReload": true,
    "failureMode": "strict"
  }
}
```

:::

### 4. 在生产环境中使用优雅失败

防止模板错误破坏生产环境：

::: v-pre

```json
{
  "templateSettings": {
    "validateOnReload": false,
    "failureMode": "graceful"
  }
}
```

:::

### 5. 适当标记模板

使用静态标签以启用预设的正确过滤：

::: v-pre

```json
{
  "mcpTemplates": {
    "team-server": {
      "tags": ["filesystem", "search", "team"]
    }
  }
}
```

:::

> **注意**: `tags` 数组中的模板表达式（例如 <span v-pre>`"team-{{project.custom.team}}"`</span>）不会被渲染——它们将作为字面量标签字符串使用。请仅使用静态标签值。

## 故障排除

### 公开模板上下文会被忽略

**症状**：模板变量显示为字面量 <span v-pre>`{{variable}}`</span> 字符串

**处理方式**：这是公开 HTTP、REST 和 `1mcp proxy` 客户端预期的默认拒绝行为。请使用静态 `mcpServers` 定义，并为 `command`、`args`、`cwd` 和 `env` 提供固定值。在此版本中，把定义移入 `mcpTemplates`、收集更多上下文或添加 `.1mcprc` 数据都不能启用公开渲染。

### 未来或仅限内部的模板诊断

以下检查仅适用于内部可信测试或未来经过认证的服务端上下文集成，不能启用公开客户端上下文渲染。

#### 自定义上下文缺失

**症状**：<span v-pre>`{{project.custom.*}}`</span> 变量未定义

**解决方案**：

1. 检查 `.1mcprc` 文件是否存在于项目根目录中
2. 验证 `.1mcprc` 中的 JSON 语法
3. 确保 `context.custom` 对象结构正确

#### 服务器未启动

**症状**：模板服务器启动失败

**解决方案**：

1. 检查日志中的渲染后配置
2. 在模板渲染后验证命令路径
3. 确保环境变量正确引用

#### 条件逻辑不工作

**症状**：<span v-pre>`{{#if}}`</span> 条件未按预期评估

**解决方案**：

1. 使用比较辅助函数：<span v-pre>`{{#if (eq var 'value')}}`</span>
2. 检查值中的空格
3. 启用调试日志以查看实际值

## 另请参阅

- **[模板语法参考](/zh/reference/mcp-templates/syntax)** - 完整的语法和辅助函数参考
- **[自定义指令模板](/zh/guide/custom-instructions-template)** - 自定义 LLM 指令（不同功能）
- **[上下文收集](/zh/guide/advanced/server-filtering)** - 如何收集上下文
- **[服务器过滤](/zh/guide/advanced/server-filtering)** - 基于标签的过滤
