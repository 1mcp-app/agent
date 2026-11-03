---
title: MCP 操作遥测
description: MCP 操作结果汇总的计数边界与有限维度。
---

# MCP 操作遥测

本文说明产品使用遥测中的操作字段。收集控制参见 [telemetry 命令](/zh/commands/telemetry)。

## 计数边界

聚合运行时为每个已接纳的 MCP 操作记录一次结果。直接标准输入输出连接、旧版 HTTP/SSE 和新版 HTTP 请求均由运行时计数。标准输入输出代理只转发请求，不产生第二份操作记录。内部网关桥接、REST 适配器、上游重试、通知、清理及重复的终结响应不增加操作计数。

正常完成的响应记为 `success`；协议错误、带有 `isError: true` 的工具结果、取消，以及操作完成前连接中断，记为 `failure`。协议版本 1 不单独区分取消。响应返回不等待遥测发送。禁用或重置会使此前的收集接纳状态失效；迟到的响应不能将旧记录归入新的安装状态。

`input_required` 属于成功的协议响应；后续继续请求是另一个已接纳请求。这些结果不代表用户的任务已经完成。

命令、功能和操作属于不同计数类别。一次 `run` 命令可能引发一个 MCP 操作；不能将这些计数相加后解释为唯一用户行为数。

## 导出维度

| 字段        | 取值                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `kind`      | `operation`                                                                                                                        |
| `name`      | `tools_list`、`tools_call`、`resources_list`、`resources_read`、`prompts_list`、`prompts_get`、`completion`、`initialize`、`other` |
| `outcome`   | `success`、`failure`                                                                                                               |
| `transport` | `stdio`、`http`、`sse`                                                                                                             |
| `client`    | `claude`、`codex`、`cursor`、`vscode`、`other`                                                                                     |
| `bucket`    | `none`                                                                                                                             |
| `count`     | 汇总发生次数                                                                                                                       |

名称根据对应的 MCP 方法映射，例如 `tools/list` 映射为 `tools_list`；`completion/complete` 映射为 `completion`。其他已接纳方法使用 `other`。HTTP 流式响应仍标记为 `http`；旧版 SSE 传输标记为 `sse`。

客户端识别使用精确匹配的有限名称：`claude`、`claude-ai`、`claude-code` 映射为 `claude`；`codex`、`codex-mcp-client` 映射为 `codex`；`cursor` 映射为 `cursor`；`vscode`、`Visual Studio Code` 映射为 `vscode`。未知名称、缺失信息、访问器及代理对象均映射为 `other`。不导出客户端标题或版本。

计数不包含任意方法名、客户端名、工具名、后端名、URI、请求参数、结果内容、错误文本或诊断字段。普通测试和持续集成端到端测试始终禁止收集。

传输标签描述运行时入口。标准输入输出代理连接 HTTP 运行时时记录 `http`，本地不重复记录操作；直接连接运行时标准输入输出时记录 `stdio`。
