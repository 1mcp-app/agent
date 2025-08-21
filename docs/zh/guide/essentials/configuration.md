# 配置深入探讨

1MCP 代理是高度可配置的，允许您根据从本地开发到生产部署的各种情况调整其行为。可以通过 JSON 文件、命令行参数和环境变量来管理配置，这些配置按此优先顺序应用。

## 配置方法

1.  **JSON 文件**：定义服务器和全局设置的主要方法。
2.  **命令行标志**：用于在运行时覆盖特定设置。
3.  **环境变量**：对容器化部署和 CI/CD 非常有用。

---

## 1. JSON 配置文件

代理使用 JSON 文件（例如 `mcp.json`）来定义后端服务器和全局设置。

### 默认位置

- **macOS**：`~/.config/1mcp/mcp.json`
- **Linux**：`~/.config/1mcp/mcp.json`
- **Windows**：`%APPDATA%\1mcp\mcp.json`

您可以使用 `--config` 标志覆盖路径。

### 顶级结构

```json
{
  "mcpServers": {
    // 服务器定义
  }
}
```

### `mcpServers` 部分

这是代理将管理的所有后端 MCP 服务器的字典。

- **键**：服务器的唯一、人类可读的名称（例如 `my-filesystem`）。
- **值**：服务器配置对象。

#### 服务器属性

**通用属性：**

- `transport`（字符串，可选）：`stdio` 或 `http`。如果存在 `command`，则默认为 `stdio`；如果存在 `url`，则默认为 `http`。
- `tags`（字符串数组，必需）：用于路由和访问控制的标签。
- `timeout`（数字，可选）：连接超时（以毫秒为单位）。
- `enabled`（布尔值，可选）：设置为 `false` 以禁用服务器。默认为 `true`。

**HTTP 传输属性：**

- `url`（字符串，`http` 必需）：远程 MCP 服务器的 URL。

**Stdio 传输属性：**

- `command`（字符串，`stdio` 必需）：要执行的命令。
- `args`（字符串数组，可选）：命令的参数。
- `cwd`（字符串，可选）：进程的工作目录。
- `env`（对象或数组，可选）：环境变量。可以是对象 `{"KEY": "value"}` 或数组 `["KEY=value", "PATH"]`。
- `inheritParentEnv`（布尔值，可选）：从父进程继承环境变量。默认为 `false`。
- `envFilter`（字符串数组，可选）：过滤继承环境变量的模式。支持 `*` 通配符和 `!` 排除。
- `restartOnExit`（布尔值，可选）：进程退出时自动重启。默认为 `false`。
- `maxRestarts`（数字，可选）：最大重启尝试次数。如果未指定，则允许无限制重启。
- `restartDelay`（数字，可选）：重启尝试之间的延迟（以毫秒为单位）。默认为 `1000`（1 秒）。

#### `mcpServers` 示例

**基本配置：**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["--root", "/data"],
      "tags": ["files", "local-data"]
    },
    "remote-api": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "tags": ["api", "prod"],
      "timeout": 15000
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
      "timeout": 30000
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

## 2. 增强的环境变量功能

1MCP 代理为 stdio 传输服务器提供高级环境变量管理。

### 环境变量替换

在配置中使用 `${VARIABLE_NAME}` 语法在运行时替换环境变量：

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
设置 `inheritParentEnv: true` 从父进程继承环境变量：

```json
{
  "inheritParentEnv": true
}
```

**环境过滤：**
使用 `envFilter` 通过模式匹配控制继承哪些变量：

```json
{
  "inheritParentEnv": true,
  "envFilter": [
    "PATH", // 允许 PATH 变量
    "HOME", // 允许 HOME 变量
    "NODE_*", // 允许所有 NODE_* 变量
    "NPM_*", // 允许所有 NPM_* 变量
    "!SECRET_*", // 阻止所有 SECRET_* 变量
    "!BASH_FUNC_*" // 阻止 bash 函数定义
  ]
}
```

**过滤模式：**

- `VARIABLE_NAME`：包含特定变量
- `PREFIX_*`：包含所有以 PREFIX\_ 开头的变量
- `!VARIABLE_NAME`：排除特定变量
- `!PREFIX_*`：排除所有以 PREFIX\_ 开头的变量

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
  "env": [
    "NODE_ENV=production",
    "DEBUG=false",
    "PATH", // 从父进程继承 PATH
    "API_TIMEOUT=${TIMEOUT_VALUE}"
  ]
}
```

### 进程管理

**自动重启：**
在服务器意外退出时启用自动进程重启：

```json
{
  "restartOnExit": true,
  "maxRestarts": 5,
  "restartDelay": 2000
}
```

**重启配置选项：**

- `restartOnExit`：启用自动重启功能
- `maxRestarts`：限制重启尝试次数（省略表示无限制重启）
- `restartDelay`：重启尝试之间等待的毫秒数（默认：1000ms）

**工作目录：**
为进程设置自定义工作目录：

```json
{
  "cwd": "/path/to/server/directory"
}
```

### 完整示例

```json
{
  "mcpServers": {
    "production-server": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/app",

      // 带安全过滤的环境继承
      "inheritParentEnv": true,
      "envFilter": [
        "PATH",
        "HOME",
        "USER", // 基本系统变量
        "NODE_*",
        "NPM_*", // Node.js 相关
        "!SECRET_*",
        "!KEY_*", // 阻止密钥
        "!BASH_FUNC_*" // 阻止函数
      ],

      // 带替换的自定义环境
      "env": {
        "NODE_ENV": "production",
        "API_KEY": "${PROD_API_KEY}",
        "DB_URL": "${DATABASE_CONNECTION}",
        "LOG_LEVEL": "info"
      },

      // 进程管理
      "restartOnExit": true,
      "maxRestarts": 3,
      "restartDelay": 1500,

      // 标准 MCP 属性
      "tags": ["production", "api"],
      "timeout": 30000
    }
  }
}
```

---

## 3. 命令行标志

标志会覆盖 JSON 配置文件中的设置。

### 传输选项

- `--transport, -t <type>`：传输类型（`stdio`、`http`）。`sse` 已弃用。

### HTTP 传输选项

- `--port, -P <port>`：HTTP 端口。默认值：`3050`。
- `--host, -H <host>`：HTTP 主机。默认值：`localhost`。
- `--external-url, -u <url>`：服务器的外部 URL（用于 OAuth 回调和公共 URL）。

### 配置选项

- `--config, -c <path>`：配置文件的路径。

### 安全选项

- `--auth`：启用 OAuth 2.1 身份验证（已弃用，请使用 `--enable-auth`）。默认值：`false`。
- `--enable-auth`：启用身份验证（OAuth 2.1）。默认值：`false`。
- `--enable-scope-validation`：启用基于标签的范围验证。默认值：`true`。
- `--enable-enhanced-security`：启用增强安全中间件。默认值：`false`。
- `--session-ttl <minutes>`：会话过期时间（分钟）。默认值：`1440`（24 小时）。
- `--session-storage-path <path>`：自定义会话存储目录路径。
- `--rate-limit-window <minutes>`：OAuth 速率限制窗口（分钟）。默认值：`15`。
- `--rate-limit-max <requests>`：每个 OAuth 速率限制窗口的最大请求数。默认值：`100`。

### 网络选项

- `--trust-proxy <config>`：信任代理配置。请参阅[信任代理指南](/reference/trust-proxy)。默认值：`loopback`。

### 过滤选项

- `--tags, -g <tags>`：过滤客户端的标签（逗号分隔）。
- `--pagination, -p`：启用分页。默认值：`false`。

### 健康检查选项

- `--health-info-level <level>`：`full`、`basic`、`minimal`。默认值：`minimal`。

### 异步加载

- `--enable-async-loading`：启用异步 MCP 服务器加载。

### 日志选项

- `--log-level <level>`：设置日志级别（`debug`、`info`、`warn`、`error`）。默认值：`info`。
- `--log-file <path>`：将日志写入文件跟控制台。指定后，除 stdio 传输外，控制台日志将被禁用。

#### 日志示例

```bash
# 通过 CLI 设置日志级别
npx -y @1mcp/agent --log-level debug

# 记录到文件（禁用控制台输出）
npx -y @1mcp/agent --log-file /var/log/1mcp.log

# 组合日志配置
npx -y @1mcp/agent --log-level debug --log-file app.log

# 使用环境变量
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent
ONE_MCP_LOG_FILE=/var/log/1mcp.log npx -y @1mcp/agent
```

#### 从 LOG_LEVEL 迁移

传统的 `LOG_LEVEL` 环境变量仍然受支持，但已弃用：

```bash
# ⚠️  已弃用（显示警告）
LOG_LEVEL=debug npx -y @1mcp/agent

# ✅ 推荐
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent
# 或
npx -y @1mcp/agent --log-level debug
```

---

## 4. 环境变量

环境变量以 `ONE_MCP_` 为前缀，对容器化环境非常有用。它们会覆盖 JSON 和 CLI 设置。

- `ONE_MCP_PORT`
- `ONE_MCP_HOST`
- `ONE_MCP_EXTERNAL_URL`
- `ONE_MCP_CONFIG_PATH`
- `ONE_MCP_CONFIG_WATCH`
- `ONE_MCP_LOG_LEVEL`
- `ONE_MCP_LOG_FILE`
- `ONE_MCP_TAGS`
- `ONE_MCP_PAGINATION`
- `ONE_MCP_AUTH`
- `ONE_MCP_ENABLE_AUTH`
- `ONE_MCP_ENABLE_SCOPE_VALIDATION`
- `ONE_MCP_ENABLE_ENHANCED_SECURITY`
- `ONE_MCP_SESSION_TTL`
- `ONE_MCP_SESSION_STORAGE_PATH`
- `ONE_MCP_RATE_LIMIT_WINDOW`
- `ONE_MCP_RATE_LIMIT_MAX`
- `ONE_MCP_TRUST_PROXY`
- `ONE_MCP_HEALTH_INFO_LEVEL`
- `ONE_MCP_ENABLE_ASYNC_LOADING`

---

## 热重载

代理支持配置文件的热重载。如果您在代理运行时修改 JSON 文件，它将自动应用新配置，而无需重新启动。
