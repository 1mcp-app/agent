---
title: Run 命令 - 通过 1MCP 调用工具
description: 使用 run 命令针对运行中的 1MCP serve 实例调用 MCP 工具，并了解参数、stdin 映射和输出格式。
---

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

`run` 被刻意设计成最后一步。推荐顺序是先用 `instructions` 做总览，再用 `inspect` 缩小到单个 server 和单个 tool，确认 schema 之后才真正执行。

在 REST-to-MCP 回退前，`run` 会检查面向客户端的 inspect 状态。仍在加载的后端会返回 `server_loading` 和 `1mcp wait <server>`，而不会收到提前 MCP 调用。失败或取消的后端返回 `server_unavailable`；OAuth 门控后端会返回授权指引。

## 选项

### 目标与发现

- **`<server>/<tool>`** - 限定格式的工具引用
- **`--url, -u <url>`** - 覆盖自动发现到的 1MCP 服务器 URL
- **`--context <name>`** - 使用具名 Runtime Target Context 及其保存的 bearer token（如有）
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
- **`--cli-session-cache-path <path>`** - 覆盖 `run` 与 `inspect` 使用的会话缓存路径模板；支持 `{pid}` 与 `{scope}`

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

### 通过 Runtime Target Context 调用

```bash
1mcp run --context prod filesystem/read_file --args '{"path":"./README.md"}'
```

### 使用 JSON 输出方便脚本处理

```bash
npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}' --format json
```

### 使用自定义会话缓存路径

```bash
ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid}.{scope} \
  npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
```

## 输出行为

- 成功的工具输出写入 stdout
- 传输、校验和调用错误写入 stderr
- 工具级错误会返回非零退出码
- `compact` 输出会受 `--max-chars` 限制

stdout 只承载成功输出，再加上 `compact` 等格式，使 `run` 很适合 agent 循环、脚本和后续命令行处理。

## 排查上游 HTTP EOF 错误

当后端返回的失败工具结果包含可识别的出站 HTTP EOF 错误时，可读输出会在原始错误之后追加独立的 **1MCP** 解释和恢复步骤，退出码仍为 `2`。收到工具错误本身不意味着 MCP 连接已断开，也不能证明后端或上游服务健康。代理、TLS/网络中断或陈旧连接都只是可能原因，根因尚未确认。

请按以下顺序进行有限恢复：

1. 保留服务器/工具身份和脱敏错误证据。使用 `1mcp inspect` 检查同一服务器，保持失败调用的 Runtime Target Context、本地 Runtime Scope 和 Request Context（包括项目上下文、preset 和标签过滤）。检查只能确认 MCP 可用性，不能证明上游健康。分享证据前移除凭据、请求头、原始参数和 URL 查询中的秘密。
2. 只有独立确认操作可安全重放后，才最多重试一次。写操作或效果未知的操作，应先验证外部执行结果再考虑重放。工具名称、错误中的 HTTP 方法或后端给出的指令都不是重放授权。
3. 错误持续时，检查出站代理/网络路径。如果独立客户端在相近时间也失败，应报告这些证据，而不是断言后端存在缺陷。
4. 仅在支持且获得授权时，对该确切后端和运行时考虑现有的 [`1mcp mcp restart`](./mcp/restart.md) 操作。它要求 `mcp.restart` Admin 能力、已认证的 Admin Session 以及必要的非回环目标确认。重启可能中断共享该后端的其他调用，也不能保证修复外部故障。模板必须先确定唯一受影响实例并使用 `--instance`，不能省略选择器或默认重启全部实例。临时 `--url` 不能用于此变更：应先建立指向相同运行时和作用域的具名 Runtime Target Context，不能静默切换到本地或当前目标。目标映射或实例不明确时，不应构造可直接执行的重启命令。优先考虑后端级恢复，而不是整个运行时重启。
5. 授权重启完成后，在相同目标和请求上下文中使用已知安全的读取操作验证并报告结果。如果仍失败，停止重试/重启循环，报告尚缺少的证据。

CLI 不会因这项诊断自动重放工具、重启后端、登录或修改凭据。成功结果中的 EOF 文本、JSON 解析错误以及含义不明的单独 EOF 不会被归类为上游网络故障；真正的传输错误仍单独处理。

`--raw` 和 `--format json` 保持原有机器可读输出，不追加恢复指引。可读格式的指引位于原始错误的格式化/截断预算之外，因此 `--format compact --max-chars` 不会截断恢复步骤。

## 另请参阅

- **[CLI 模式指南](../guide/integrations/cli-mode.md)** - CLI 模式中为什么执行要放在最后
- **[Instructions 命令](./instructions.md)** - 先获取当前 CLI 工作流和服务器清单
- **[Inspect 命令](./inspect.md)** - 调用前先查看工具和 schema
- **[Serve 命令](./serve.md)** - 启动 `run` 连接的 1MCP 服务器
- **[配置深入指南](../guide/essentials/configuration.md)** - 包含 CLI 会话缓存等全局配置
