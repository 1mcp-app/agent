---
title: Inspect 命令 - 发现服务器和工具 Schema
description: 使用 inspect 命令列出服务器、检查服务器工具，并查看运行中 1MCP serve 实例的工具 schema。
---

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

支持时，`inspect` 会优先使用已认证的 `/api/v1/inspect` 端点，否则回退到 MCP 协议。它会在首个能力快照发布前报告已配置静态服务器的启动状态；脚本需要等待 `connected` 且 `available: true` 时请使用 [`wait`](/zh/commands/wait)。

它的核心作用，是把 `instructions` 提供的全局清单进一步收窄成一个 server，或者一个具体 tool 的 schema。先检查 server，再检查 tool，最后才进入执行。

## Target 形式

- **省略 target** - 列出运行中的 1MCP 实例暴露的所有服务器
- **`<server>`** - 列出某个服务器的工具
- **`<server>/<tool>`** - 查看单个工具的 schema

## 选项

### 连接与过滤

- **`--url, -u <url>`** - 覆盖自动发现到的 1MCP 服务器 URL
- **`--context <name>`** - 使用具名 Runtime Target Context 及其保存的 bearer token（如有）
- **`--preset, -p <name>`** - 查询运行中服务器时使用预设
- **`--tag-filter, -f <expression>`** - 应用高级标签过滤表达式
- **`--tags <tag>`** - 应用简单的逗号分隔标签

### 输出与分页

- **`--format <toon|text|json>`** - 输出格式
- **`--all`** - 拉取服务器 target 或搜索的全部剩余工具
- **`--limit <number>`** - 服务器工具列表和搜索结果的分页大小，默认 `20`
- **`--cursor <cursor>`** - 上一页响应返回的 cursor

### 相关全局选项

- **`--config-dir, -d <path>`** - 用于鉴权配置和服务器发现的配置目录
- **`--cli-session-cache-path <path>`** - 覆盖 `inspect` 与 `run` 使用的会话缓存路径模板；支持 `{pid}` 与 `{scope}`

## 搜索工具

不知道提供方或工具名时，先搜索可见清单，再查看确切的 schema：

```bash
1mcp inspect --search read
1mcp inspect filesystem --search read
1mcp inspect --search 'filesystem/*read?' --glob
1mcp inspect --search 'read a file' --include-descriptions
1mcp inspect --search read --show-descriptions --format json
# 阅读所选服务器的适用指令，然后查看 schema 并调用。
1mcp inspect filesystem
1mcp inspect filesystem/read_file
1mcp run filesystem/read_file --args '{"path":"README.md"}'
```

已知目标时直接检查即可。复用 hooks 已提供的当前启动指令；搜索不能替代适用的服务器指令或确切工具的 schema 检查。

- **`--search <query>`** 搜索所有可见服务器，或指定服务器。默认对 `server/tool` 引用执行不区分大小写的字面子串匹配。
- **`--glob`** 显式启用整段匹配，仅支持 `*`（任意数量字符）与 `?`（单个字符）通配符。请给模式加引号，避免 shell 展开；其他标点仍按字面匹配。
- **`--include-descriptions`** 使用所选匹配模式同时搜索有效描述，包括配置覆盖后的描述。引用与描述均匹配时工具只出现一次。
- **`--show-descriptions`** 独立控制输出是否显示描述，不改变匹配结果。仅启用描述匹配仍保持紧凑输出。

空查询、确切工具目标与搜索组合，以及未指定 `--search` 时使用搜索专属选项均会报错。搜索保留鉴权、预设与标签筛选、上下文模板可见性和禁用工具规则。

搜索返回 `server`、`tool` 及必填/可选参数数量，不返回 schema。默认格式为 TOON，也支持文本和 JSON。结果按公开服务器/工具标识排序，匹配后再分页。`--limit` 默认为 20；`--all` 返回可选游标之后的全部剩余匹配。`totalTools` 表示已收集清单中的匹配数，而非全部工具数。游标绑定查询、匹配选项、目标、筛选条件及清单；这些条件变化导致游标失效时，请移除游标重新开始。

完整搜索无匹配时仍成功。断定工具不存在前，应检查完整性及加载中/不可用元数据；部分清单不代表确实不存在，枚举失败或格式错误会报告。静态服务器仍在加载时可用 `1mcp wait <server>`。跨服务器搜索要求运行时支持 inspect 搜索；旧运行时应按提示升级并重启。单服务器搜索可使用现有 MCP 回退路径；鉴权失败始终终止，不会触发回退。

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

### 通过 Runtime Target Context 查看

```bash
1mcp inspect --context prod filesystem/read_file
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
- 找到工具的 server/tool 命令引用
- 调用前查看工具的输入和输出 schema
- 通过 JSON 输出构建自动化脚本
- 让 agent 一次只关注工具面的一个局部

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)** - 为什么推荐先缩小范围再执行
- **[Instructions 命令](./instructions.md)** - 先读取当前工作流和服务器清单
- **[Run 命令](./run.md)** - 在确认 schema 后调用工具
- **[Serve 命令](./serve.md)** - 启动 `inspect` 所查询的 1MCP 服务器
- **[配置深入指南](../guide/essentials/configuration.md)** - 包含 CLI 会话缓存等全局配置

### 工具输出与分页

CLI 使用 `server` 和 `tool` 标识工具；文本、JSON 和 TOON 输出不再显示冗余的 `qualifiedName` / `qualified_name` 字段。API 路由标识保持不变。

即使上游忽略分页大小，`--limit` 也会限制当前页的工具数。`totalTools` 表示当前可见工具的完整数量，`hasMore` 和 `nextCursor` 表示后续工具。每次检查请求都会在有界遍历上游页面（最多 1,000 页）后执行本地分页。`--all` 返回剩余全部工具；不传游标时返回全部工具。游标绑定目标、筛选条件和工具清单。游标无效或过期时，请移除 `--cursor` 后重新开始。
