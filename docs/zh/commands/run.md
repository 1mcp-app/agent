# Run 命令

通过运行中的 1MCP `serve` 实例调用 MCP 工具。

## 概要

```bash
npx -y @1mcp/agent run <server>/<tool> [选项]
```

## 描述

`run` 是 CLI 工作流中的执行步骤：

1. 先运行 [`instructions`](./instructions.md) 查看当前工作流和服务器列表
2. 再运行 [`inspect`](./inspect.md) 查看工具和工具 schema
3. 最后运行 `run` 调用目标工具

`run` 会连接到运行中的 `1mcp serve` 实例，透传 preset 和标签过滤，并把工具输出写入 stdout。错误只写入 stderr，因此适合脚本和管道。

## 选项

### 目标与发现

- **`<server>/<tool>`** - 限定格式的工具引用
- **`--url, -u <url>`** - 覆盖自动发现到的 1MCP 服务器 URL
- **`--preset, -p <name>`** - 调用运行中服务器时使用预设
- **`--tag-filter, -f <expression>`** - 应用高级标签过滤表达式
- **`--tags <tag>`** - 应用简单的逗号分隔标签

### 输入选项

- **`--args <json>`** - JSON 对象形式的工具参数

如果省略 `--args` 且提供了 stdin，`run` 会自动尝试映射 stdin：

- 如果 stdin 是 JSON 对象，就直接作为工具参数使用
- 否则会先查看工具 schema，再将 stdin 映射到第一个必填字符串参数

### 输出选项

- **`--format <toon|json|text|compact>`** - 输出格式
- **`--raw`** - `--format json` 的别名
- **`--max-chars <number>`** - `compact` 输出的最大字符数，默认 `2000`

### 相关全局选项

- **`--config-dir, -d <path>`** - 用于鉴权配置和服务器发现的配置目录
- **`--cli-session-cache-path <path>`** - 覆盖 `run` 与 `inspect` 使用的会话缓存路径模板

## 示例

### 显式传入 JSON 参数

```bash
npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
```

### 将原始 stdin 映射到必填字符串参数

```bash
npx -y @1mcp/agent run summarizer/summarize < README.md
```

### 使用预设

```bash
npx -y @1mcp/agent run --preset development validator/validate --args '{"path":"./schema.json"}'
```

### 使用 JSON 输出方便脚本处理

```bash
npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}' --format json
```

### 使用自定义会话缓存路径

```bash
ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid} \
  npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
```

## 输出行为

- 成功的工具输出写入 stdout
- 传输、校验和调用错误写入 stderr
- 工具级错误会返回非零退出码
- `compact` 输出会受 `--max-chars` 限制

## 另请参阅

- **[Instructions 命令](./instructions.md)** - 先获取当前 CLI 工作流和服务器清单
- **[Inspect 命令](./inspect.md)** - 调用前先查看工具和 schema
- **[Serve 命令](./serve.md)** - 启动 `run` 连接的 1MCP 服务器
- **[配置深入指南](../guide/essentials/configuration.md)** - 包含 CLI 会话缓存等全局配置
