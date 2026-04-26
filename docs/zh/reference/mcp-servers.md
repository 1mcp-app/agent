# MCP 服务器配置参考

本文档提供了在 1MCP 代理中配置 MCP (Model Context Protocol) 服务器的全面参考文档。

## 概述

1MCP 代理通过 JSON 配置文件管理多个后端 MCP 服务器。您可以在 `serverDefaults` 中定义共享默认值，并在 `mcpServers` 部分中为每个服务器定义控制其行为、传输方法和环境的特定属性。

---

## 配置文件结构

### JSON 文件结构

代理使用 JSON 文件（例如 `mcp.json`）来定义后端服务器及其设置。

```json
{
  "serverDefaults": {
    // 所有服务器可选的共享默认值
  },
  "mcpServers": {
    // 服务器定义
  }
}
```

### 默认位置

- **macOS**: `~/.config/1mcp/mcp.json`
- **Linux**: `~/.config/1mcp/mcp.json`
- **Windows**: `%APPDATA%\1mcp\mcp.json`

### 配置目录覆盖

代理支持覆盖整个配置目录位置，这会影响配置文件、备份和其他相关文件的存储位置。

**默认位置：**

- **macOS**: `~/.config/1mcp/`
- **Linux**: `~/.config/1mcp/`
- **Windows**: `%APPDATA%\1mcp\`

**覆盖方法：**

1. **命令行标志：**

   ```bash
   npx -y @1mcp/agent --config-dir /custom/config/path
   ```

2. **环境变量：**
   ```bash
   ONE_MCP_CONFIG_DIR=/custom/config/path npx -y @1mcp/agent
   ```

当您覆盖配置目录时，代理将：

- 在指定目录中查找 `mcp.json`
- 在 `backups` 子目录中存储备份
- 在指定目录中存储预设和其他配置文件

**示例：**

```bash
# 使用项目特定的配置目录
npx -y @1mcp/agent --config-dir ./project-config
```

这为需要隔离配置的项目创建了一个自包含的配置设置。

---

## MCP 服务器配置

### `serverDefaults` 部分

可选的共享默认值，所有服务器都会继承。允许的键：

- `env`
- `timeout`
- `connectionTimeout`
- `requestTimeout`
- `oauth`
- `headers`
- `inheritParentEnv`
- `envFilter`

合并行为：

- `env` 对象会与各服务器的 `env` 合并，若键冲突则以服务器自身的值为准。
- `oauth` 和 `headers` 会被服务器上的值整体替换，不会做深度合并。
- 基本类型值（`timeout`、`connectionTimeout`、`requestTimeout`、`inheritParentEnv`）仅在服务器未显式设置时继承。
- 还存在与传输类型相关的排除规则：全局 `headers` 会对 `stdio` 传输忽略，而全局 `inheritParentEnv` 和 `envFilter` 会对 `http`、`sse` 和 `streamableHttp` 传输忽略。
- 当 `serverDefaults.env` 与 `mcpServers.<name>.env` 都使用数组格式时，不会逐项合并，而是以服务器自己的数组为准。

### 迁移指南（从每服务器配置迁移到共享默认值）

您可以把各服务器中重复出现的设置提取到 `serverDefaults`，而不改变实际行为：

1. 找出多个服务器重复使用的键（`env`、`connectionTimeout`、`requestTimeout`、`oauth`、`headers`、`inheritParentEnv`）。
2. 将共享值移动到 `serverDefaults`。
3. 将服务器特有的覆盖项保留在各自的服务器定义中。
4. 运行 `1mcp mcp status --verbose`，确认每个服务器的最终合并配置符合预期。

### `serverDefaults` 环境变量参考

`serverDefaults.env` 支持两种格式：

- 对象格式：`{ "KEY": "value" }`
- 数组格式：`["KEY=value"]`

当 `serverDefaults.env` 与 `mcpServers.<name>.env` 都使用对象格式时，两者会进行合并；发生键冲突时，以服务器自身的值覆盖共享默认值。

### `mcpServers` 部分

这是代理将管理的所有后端 MCP 服务器的字典。

- **键**: 服务器的唯一、人类可读名称（例如 `my-filesystem`）。
- **值**: 服务器配置对象。

### 服务器属性

**通用属性：**

- `transport` (字符串, 可选): `stdio` 或 `http`。如果存在 `command` 则默认为 `stdio`，如果存在 `url` 则默认为 `http`。
- `tags` (字符串数组, 可选): 用于路由和访问控制的标签。预设过滤功能需要此字段才能正常工作。
- `connectionTimeout` (数字, 可选): 连接超时时间（毫秒）。用于建立初始连接。优先级高于 `timeout`。
- `requestTimeout` (数字, 可选): 请求超时时间（毫秒）。用于单个 MCP 操作（callTool、readResource 等）。优先级高于 `timeout`。
- `timeout` (数字, 可选): **已弃用** 的回退超时时间（毫秒）。当未设置特定超时时使用。新配置应使用 `connectionTimeout` 和 `requestTimeout`。
- `enabled` (布尔值, 可选): 设置为 `false` 以禁用服务器。默认为 `true`。

**HTTP 传输属性：**

- `url` (字符串, `http` 必需): 远程 MCP 服务器的 URL。

**Stdio 传输属性：**

- `command` (字符串, `stdio` 必需): 要执行的命令。
- `args` (字符串数组, 可选): 命令的参数。
- `cwd` (字符串, 可选): 进程的工作目录。
- `env` (对象或数组, 可选): 环境变量。可以是对象 `{"KEY": "value"}` 或数组 `["KEY=value", "PATH"]`。
- `inheritParentEnv` (布尔值, 可选): 从父进程继承环境变量。默认为 `false`。
- `envFilter` (字符串数组, 可选): 用于过滤继承的环境变量的模式。支持 `*` 通配符和 `!` 排除。
- `restartOnExit` (布尔值, 可选): 进程退出时自动重启。默认为 `false`。
- `maxRestarts` (数字, 可选): 最大重启尝试次数。如果未指定，则允许无限重启。
- `restartDelay` (数字, 可选): 重启尝试之间的延迟（毫秒）。默认为 `1000`（1秒）。

### 配置示例

**基本配置：**

```json
{
  "serverDefaults": {
    "connectionTimeout": 10000,
    "requestTimeout": 30000,
    "env": {
      "HTTP_PROXY": "${HTTP_PROXY}",
      "API_KEY": "${GLOBAL_API_KEY}"
    }
  },
  "mcpServers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["--root", "/data"],
      "tags": ["files", "local-data"]
    },
    "remote-api": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer local-token"
      },
      "tags": ["api", "prod"],
      "requestTimeout": 15000
    }
  }
}
```

**增强的 Stdio 配置：**

```json
{
  "mcpServers": {
    "enhanced-server": {
      "command": "node",
      "args": ["server.js"],
      "cwd": "/app",
      "inheritParentEnv": true,
      "envFilter": ["PATH", "HOME", "NODE_*", "!SECRET_*", "!BASH_FUNC_*"],
      "env": {
        "NODE_ENV": "production",
        "API_KEY": "${MCP_API_KEY}",
        "DEBUG": "false"
      },
      "restartOnExit": true,
      "maxRestarts": 5,
      "restartDelay": 2000,
      "tags": ["production", "api"],
      "connectionTimeout": 10000,
      "requestTimeout": 30000
    }
  }
}
```

**数组环境格式：**

```json
{
  "mcpServers": {
    "array-env-server": {
      "command": "python",
      "args": ["server.py"],
      "env": ["PATH", "NODE_ENV=production", "API_KEY=${SECRET_KEY}"],
      "tags": ["python", "api"]
    }
  }
}
```

---

## 高级环境管理

### 环境变量替换

在您的配置中使用 `${VARIABLE_NAME}` 语法在运行时替换环境变量：

```json
{
  "mcpServers": {
    "dynamic-server": {
      "command": "${SERVER_COMMAND}",
      "args": ["--port", "${SERVER_PORT}"],
      "env": {
        "API_KEY": "${SECRET_API_KEY}",
        "DATABASE_URL": "${DB_CONNECTION_STRING}"
      },
      "tags": ["dynamic"]
    }
  }
}
```

### 环境继承和过滤

**继承父环境：**
设置 `inheritParentEnv: true` 以从父进程继承环境变量：

```json
{
  "inheritParentEnv": true
}
```

**环境过滤：**
使用 `envFilter` 通过模式匹配控制哪些变量被继承：

```json
{
  "inheritParentEnv": true,
  "envFilter": ["PATH", "HOME", "NODE_*", "NPM_*", "!SECRET_*", "!BASH_FUNC_*"]
}
```

**过滤模式：**

- `VARIABLE_NAME`: 包含特定变量
- `PREFIX_*`: 包含所有以 PREFIX\_ 开头的变量
- `!VARIABLE_NAME`: 排除特定变量
- `!PREFIX_*`: 排除所有以 PREFIX\_ 开头的变量

### 灵活的环境格式

**对象格式（传统）：**

```json
{
  "env": {
    "NODE_ENV": "production",
    "DEBUG": "false",
    "API_TIMEOUT": "30000"
  }
}
```

**数组格式（Docker 风格）：**

```json
{
  "env": ["NODE_ENV=production", "DEBUG=false", "PATH", "API_TIMEOUT=${TIMEOUT_VALUE}"]
}
```

---

## 进程管理

### 自动重启

当服务器意外退出时启用自动进程重启：

```json
{
  "restartOnExit": true,
  "maxRestarts": 5,
  "restartDelay": 2000
}
```

**重启配置选项：**

- `restartOnExit`: 启用自动重启功能
- `maxRestarts`: 限制重启尝试次数（省略则允许无限重启）
- `restartDelay`: 重启尝试之间等待的毫秒数（默认：1000ms）

### 工作目录

为进程设置自定义工作目录：

```json
{
  "cwd": "/path/to/server/directory"
}
```

---

## 完整配置示例

```json
{
  "mcpServers": {
    "production-server": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/app",

      "inheritParentEnv": true,
      "envFilter": ["PATH", "HOME", "USER", "NODE_*", "NPM_*", "!SECRET_*", "!KEY_*", "!BASH_FUNC_*"],
      "env": {
        "NODE_ENV": "production",
        "API_KEY": "${PROD_API_KEY}",
        "DB_URL": "${DATABASE_CONNECTION}",
        "LOG_LEVEL": "info"
      },
      "restartOnExit": true,
      "maxRestarts": 3,
      "restartDelay": 1500,
      "tags": ["production", "api"],
      "connectionTimeout": 10000,
      "requestTimeout": 30000
    }
  }
}
```

---

## 超时配置

### 超时层次结构

1MCP 代理支持细粒度超时配置，具有以下优先级层次结构：

- **连接操作**: `connectionTimeout` > `timeout` (回退)
- **请求操作**: `requestTimeout` > `timeout` (回退)

### 超时类型

**`connectionTimeout`**

- **用途**: 建立与 MCP 服务器初始连接的超时时间
- **使用场景**: 服务器启动或重试时调用 `client.connect()`
- **单位**: 毫秒
- **推荐值**: 5000-15000ms（5-15 秒），取决于网络条件

**`requestTimeout`**

- **用途**: 单个 MCP 操作（工具、资源等）的超时时间
- **使用场景**: `callTool()`、`readResource()`、`listRoots()` 等
- **单位**: 毫秒
- **推荐值**: 15000-60000ms（15-60 秒），取决于操作复杂度

**`timeout` (已弃用)**

- **用途**: 未设置特定超时时的回退超时时间
- **状态**: 新配置中已弃用
- **行为**: 用作连接和请求操作的回退

### 超时配置示例

**细粒度超时配置：**

```json
{
  "mcpServers": {
    "fast-api": {
      "transport": "http",
      "url": "https://fast-api.example.com/mcp",
      "connectionTimeout": 3000,
      "requestTimeout": 10000,
      "tags": ["api", "fast"]
    },
    "heavy-processor": {
      "transport": "http",
      "url": "https://heavy.example.com/mcp",
      "connectionTimeout": 10000,
      "requestTimeout": 120000,
      "tags": ["processing", "slow"]
    },
    "backward-compatible": {
      "transport": "http",
      "url": "https://legacy.example.com/mcp",
      "timeout": 30000,
      "tags": ["legacy"]
    }
  }
}
```

**传输特定注意事项：**

- **HTTP/SSE 传输**: 由于网络延迟需要更长的连接超时时间
- **STDIO 传输**: 通常需要较短的连接超时时间（本地进程）
- **重试逻辑**: 失败的连接会触发 HTTP/SSE 的传输重建

### 从单一超时迁移

**之前（已弃用）：**

```json
{
  "timeout": 30000
}
```

**之后（推荐）：**

```json
{
  "connectionTimeout": 5000,
  "requestTimeout": 30000
}
```

---

## 热重载

代理支持配置文件的热重载。如果您在代理运行时修改 JSON 文件，它将自动应用新配置而无需重启。

---

## MCP 服务器模板

MCP 服务器模板支持动态、上下文感知的服务器配置。您可以定义模板配置，这些配置会根据运行时上下文（如当前项目、用户、环境或客户端连接）自动调整，而无需硬编码服务器设置。

### 模板配置

模板在配置的 `mcpTemplates` 部分中定义：

::: v-pre

```json
{
  "mcpTemplates": {
    "project-filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{project.path}}"],
      "tags": ["filesystem", "project"]
    },
    "conditional-server": {
      "command": "node",
      "args": ["{{project.path}}/server.js"],
      "env": {
        "NODE_ENV": "{{project.environment}}",
        "DEBUG": "{{#if (eq project.environment 'development')}}true{{else}}false{{/if}}"
      },
      "disabled": "{{#if (eq project.environment 'production')}}true{{else}}false{{/if}}"
    }
  }
}
```

:::

### 可用的模板变量

模板可以访问四个命名空间的上下文变量：

**项目变量** (`project.*`):

- `project.path` - 当前项目的绝对路径
- `project.name` - 项目目录名称
- `project.environment` - 环境名称
- `project.git.branch` - Git 分支名称
- `project.custom.*` - 来自 `.1mcprc` 文件的自定义值

**用户变量** (`user.*`):

- `user.username` - 系统用户名
- `user.name` - 用户全名
- `user.email` - 用户邮箱地址
- `user.home` - 主目录路径

**传输变量** (`transport.*`):

- `transport.type` - 传输协议 (`http`、`sse`、`stdio`)
- `transport.client.name` - 客户端应用名称 (`cursor`、`claude-code`)
- `transport.client.version` - 客户端版本

### 模板语法

1MCP 使用 [Handlebars](https://handlebarsjs.com/) 进行模板渲染：

::: v-pre

```text
{{project.path}}
<!-- 变量访问 -->
{{#if (eq project.environment 'production')}}
  <!-- 条件语句 -->
  production-value
{{else}}
  development-value
{{/if}}
{{#if (and condition1 condition2)}}
  <!-- 逻辑运算符 -->
{{/if}}
```

:::

### 上下文增强 (.1mcprc)

项目级别的上下文可以通过 `.1mcprc` 文件增强：

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
      "apiEndpoint": "https://dev-api.example.com"
    }
  }
}
```

自定义值可以在模板中作为 <span v-pre>`{{project.custom.*}}`</span> 访问。

### 模板设置

控制模板处理行为：

```json
{
  "templateSettings": {
    "validateOnReload": true,
    "failureMode": "graceful",
    "cacheContext": true
  }
}
```

| 设置               | 类型                   | 描述                       |
| ------------------ | ---------------------- | -------------------------- |
| `validateOnReload` | boolean                | 重新加载配置时验证模板     |
| `failureMode`      | `'strict'\|'graceful'` | 如何处理模板错误           |
| `cacheContext`     | boolean                | 按上下文哈希缓存渲染的模板 |

有关模板的完整文档，请参阅 [MCP 服务器模板指南](/zh/guide/mcp-server-templates) 和 [模板语法参考](/zh/reference/mcp-templates/syntax)。

---

## 另请参阅

- **[配置深入指南](../guide/essentials/configuration.md)** - CLI 标志和环境变量
- **[Serve 命令参考](../commands/serve.md)** - 命令行使用示例
- **[安全指南](security.md)** - MCP 服务器的安全最佳实践
