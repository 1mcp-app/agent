---
title: Prepare 命令 - 后端就绪检查和准备任务
description: 使用 1MCP 检查检出目录的后端就绪状态，请求已授权的准备工作，并监控、取消或重试异步任务。
head:
  - ['meta', { name: 'keywords', content: '1MCP prepare,preparation,后端就绪,任务状态,智能体引导' }]
  - ['meta', { property: 'og:title', content: '1MCP Prepare 命令参考' }]
  - ['meta', { property: 'og:description', content: '检查后端就绪状态并管理运行时拥有的准备任务。' }]
---

# Prepare 命令

为选定的检出目录和操作准备已配置的后端，例如初始化索引或同步变更的源码。准备工作使用运行时管理员配置的集成命令和操作权限。此功能需要运行时的 HTTP preparation 端点，不会回退到直接调用上游 MCP。

## 适用人群

- **人员/管理员**：配置集成、允许的操作和自动准备偏好，并排查失败原因。
- **智能体**：检查就绪状态，在现有授权范围内请求准备工作，监控任务，并在验证就绪后恢复工具调用。不得通过扩大权限或启用自动准备来绕过阻塞。

[CLI Setup](/zh/commands/cli-setup) 安装由 `bootstrap` hooks 传递的指引。安装指引不会执行准备工作或更改权限。配置和集成要求请参阅[后端准备](/zh/guide/backend-preparation)。

## 语法

```bash
1mcp prepare <backend> [options]
1mcp prepare start <backend> [options]
1mcp prepare inspect <backend> [options]
1mcp prepare status <backend> [id] [options]
1mcp prepare wait <backend> <id> [options]
1mcp prepare cancel <backend> <id> [options]
1mcp prepare retry <backend> [id] [options]
```

`backend` 是配置中的服务器名称，不是可执行文件或工具引用。`prepare <backend>` 是 `prepare start <backend>` 的简写。服务器名称与子命令重名时，请显式使用 `start`，例如 `1mcp prepare start status`。

现有的 `1mcp preparation <action> <backend> [id]` 语法保留为 `inspect`、`status`、`wait`、`cancel` 和 `retry` 的兼容别名，不输出弃用警告。

## 操作

| 操作              | 行为                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `start`（或简写） | 探测就绪状态，在需要时请求允许的准备工作；返回就绪结果或异步任务。                          |
| `inspect`         | 读取就绪状态及可用的任务/进度信息，不调度工作、不重试失败任务。初始工具列表为空时也可使用。 |
| `status`          | 按 ID 读取任务；省略 ID 时解析所选目标和操作的当前状态。                                    |
| `wait`            | 在有限时间内等待指定任务。返回运行中状态表示准备尚未结束。                                  |
| `cancel`          | 请求取消运行时拥有的任务及其附属进程。兼容的调用方可能共享此任务。                          |
| `retry`           | 重新探测后显式重试，仍受运行时权限约束；省略 ID 时解析所选目标/操作保留的任务。             |

`start` 和 `inspect` 不接受 ID；`wait` 和 `cancel` 必须使用返回的任务 ID。ID 与所有者、目标、操作和有效配置绑定。按 ID 控制任务时会自动恢复其操作；显式提供冲突的 `--operation` 会被拒绝。

## 选项

| 选项                                                            | 含义                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `--project <path-or-label>`                                     | 绝对检出路径，或项目集中的成员标签。检出目录相关的工作应选择一个目录。                      |
| `--project-set <path>`                                          | 已保存的项目集定义，使用 `--project <label>` 选择检出目录。                                 |
| `--operation <name>`                                            | 特定操作的就绪检查，通常为上游工具名称。保留检查/启动时的值；按 ID 控制时可自动恢复。       |
| `--url <url>`                                                   | 覆盖检测到的运行时 URL。                                                                    |
| `--context <name>`                                              | 使用命名的运行时目标上下文连接。                                                            |
| `--preset <name>`、`--tags <tags>`、`--tag-filter <expression>` | 现有的运行时过滤器；整个工作流中保持相同选择。                                              |
| `--format <text\|json>`                                         | 输出格式，默认 `text`。智能体可使用 `json` 读取结构化状态和任务 ID。                        |
| `--wait-ms <milliseconds>`                                      | 仅供 `wait` 使用，整数范围为 0 至 3,600,000。省略时使用运行时默认值，不会延长任务执行期限。 |

全局配置选项同样适用。使用 `1mcp prepare --help` 和子命令帮助查看可用参数。控制任务和后续工具调用时应保持相同的运行时、过滤器、检出目录和操作。

## 示例：检查、准备和恢复调用

假设管理员已为 `source-search` 的 `lookup` 操作配置并授权准备动作：

```bash
1mcp prepare inspect source-search --project /work/frontend --operation lookup --format json
1mcp prepare start source-search --project /work/frontend --operation lookup --format json
# 如果响应包含任务，复制其 status.id：
JOB_ID='replace-with-returned-job-id'
1mcp prepare wait source-search "$JOB_ID" --project /work/frontend --wait-ms 5000 --format json
1mcp prepare status source-search "$JOB_ID" --project /work/frontend --format json
```

如果启动操作返回 `ready`，则无需等待任务。否则应检查响应状态，只在任务仍未完成且未超出当前任务预算时继续等待。验证就绪后：

```bash
1mcp inspect source-search --project /work/frontend
1mcp inspect source-search/lookup --project /work/frontend
# 按刚检查的 schema 提供参数：
1mcp run source-search/lookup --project /work/frontend --args '{"query":"example"}'
```

**准备工作不会执行或重放原始工具调用。** 触发自动准备的工具调用也需要在就绪后重新发起。如果会话使用了额外的运行时或过滤参数，请继续携带。

## 状态和恢复

- `queued`、`running` 或 `cancelling`：观察现有任务，不重复启动工作。
- `ready`：探测已验证后端就绪；刷新发现结果，再重新调用工具。
- `not_ready`：动作结束但探测仍要求进一步工作。显式且已授权的 `retry` 可为下一个所需动作创建独立任务；动作不会自动串联执行。
- `failed` 或 `cancelled`：检查诊断后决定恢复或停止，不自动循环重试。
- `unknown`、`unsupported`、`conflict`、`forbidden`、`disabled` 或 `busy`：按照返回的指引处理并报告阻塞，不猜测就绪状态、破坏外部锁或更改权限来强制推进。

```bash
1mcp prepare retry source-search "$JOB_ID" --project /work/frontend --format json
1mcp prepare cancel source-search "$JOB_ID" --project /work/frontend --format json
```

以上是可选的恢复操作，不是应依次执行的常规步骤。只读检查不会启动准备工作。命令成功本身不能证明后端就绪，下一步应由响应状态和探测证据决定。准备工作需要已配置的集成，目前进程隔离支持 Linux 和 macOS。
