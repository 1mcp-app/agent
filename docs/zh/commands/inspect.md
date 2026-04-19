# Inspect 命令

检查运行中的 1MCP `serve` 实例所暴露的服务器和工具。

## 概要

```bash
npx -y @1mcp/agent inspect [target] [选项]
```

## 描述

`inspect` 是 CLI 工作流中的发现和 schema 查看步骤。通常在 [`instructions`](./instructions.md) 之后、[`run`](./run.md) 之前使用。

根据 target 的不同，`inspect` 可以：

- 在不带 target 时列出所有已暴露的服务器
- 在 target 为 `<server>` 时列出该服务器的工具
- 在 target 为 `<server>/<tool>` 时输出工具 schema 摘要

支持时，`inspect` 会优先使用快速的 `/api/inspect` 端点，否则回退到 MCP 协议。

## Target 形式

- **省略 target** - 列出运行中的 1MCP 实例暴露的所有服务器
- **`<server>`** - 列出某个服务器的工具
- **`<server>/<tool>`** - 查看单个工具的 schema

## 选项

### 连接与过滤

- **`--url, -u <url>`** - 覆盖自动发现到的 1MCP 服务器 URL
- **`--preset, -p <name>`** - 查询运行中服务器时使用预设
- **`--tag-filter, -f <expression>`** - 应用高级标签过滤表达式
- **`--tags <tag>`** - 应用简单的逗号分隔标签

### 输出与分页

- **`--format <toon|text|json>`** - 输出格式
- **`--all`** - 对服务器 target 拉取所有工具，跳过分页
- **`--limit <number>`** - 服务器工具列表的分页大小，默认 `20`
- **`--cursor <cursor>`** - 上一页响应返回的 cursor

### 相关全局选项

- **`--config-dir, -d <path>`** - 用于鉴权配置和服务器发现的配置目录
- **`--cli-session-cache-path <path>`** - 覆盖 `inspect` 与 `run` 使用的会话缓存路径模板

## 示例

### 列出全部服务器

```bash
npx -y @1mcp/agent inspect
```

### 列出某个服务器的工具

```bash
npx -y @1mcp/agent inspect filesystem
```

### 查看工具 schema

```bash
npx -y @1mcp/agent inspect filesystem/read_file
```

### 使用 JSON 输出进行脚本处理

```bash
npx -y @1mcp/agent inspect filesystem --format json
```

### 一次拉取服务器的全部工具

```bash
npx -y @1mcp/agent inspect filesystem --all
```

### 继续分页列表

```bash
npx -y @1mcp/agent inspect filesystem --limit 20 --cursor next-page-token
```

## 适用场景

在以下情况使用 `inspect`：

- 确认当前有哪些服务器可用
- 找到工具的准确限定名
- 调用前查看工具的输入和输出 schema
- 通过 JSON 输出构建自动化脚本

## 另请参阅

- **[Instructions 命令](./instructions.md)** - 先读取当前工作流和服务器清单
- **[Run 命令](./run.md)** - 在确认 schema 后调用工具
- **[Serve 命令](./serve.md)** - 启动 `inspect` 所查询的 1MCP 服务器
- **[配置深入指南](../guide/essentials/configuration.md)** - 包含 CLI 会话缓存等全局配置
