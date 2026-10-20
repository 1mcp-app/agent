---
title: Project 命令 - 后端准备与检出目录生命周期
description: 在选定的 1MCP 运行时中释放调用方绑定、检查阻塞项，并显式排空或恢复检出目录。
---

# Project 命令

使用 `project` 管理选定 1MCP 运行时对检出目录的使用。[项目准备命令](/zh/commands/project/prepare) 单独管理后端就绪状态及准备任务。

```bash
1mcp project status --project /work/frontend --format json
1mcp project release --project /work/frontend --project-owner /private/session-owner.json --format json
1mcp project drain --project /work/frontend --wait-ms 5000 --format json
1mcp project resume --project /work/frontend --format json
```

将示例中的凭证文件替换为当前会话 bootstrap 提供的路径。使用同一检出目录的调用方不会被视为同一所有者。

## 操作与权限

| 操作                                      | 结果                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`prepare`](/zh/commands/project/prepare) | 检查后端就绪状态并管理准备任务。                                                                                 |
| [`status`](/zh/commands/project/status)   | 检查准入、所有者、活动任务及清理阻塞项，不创建绑定、不启动准备、不延长空闲期限。                                 |
| [`release`](/zh/commands/project/release) | 仅释放已验证调用方在选定目录中的绑定，保护其他会话、兄弟工作代理、活动请求和共享后端。                           |
| [`drain`](/zh/commands/project/drain)     | 要求本地操作员权限，关闭准入，并报告当前运行时何时完成释放。已有所有者也不能启动新工作，已准入的工作可正常完成。 |
| [`resume`](/zh/commands/project/resume)   | 要求操作员权限，显式恢复准入；不会准备或启动后端。                                                               |

凭证绑定运行时，并通过已验证的本地权限签名。仅声称会话 ID、目录路径或角色不能取得权限；现有运行时认证仍然适用。远程调用方不能通过设置请求字段获得操作员权限。

排空不会取消任务或终止活动工作。各所有者需要释放绑定，任务需要完成或通过已授权的[准备控制](/zh/commands/project/prepare)显式取消。订阅和共享资源可能阻止完成。

Windows 上无法验证优雅终止时，存活的 stdio 后端会保留为阻塞项，项目清理不会改用强制终止。应通过受支持且显式授权的操作员流程停止这些后端后再次检查。以该目录为工作目录的静态后端也属于共享阻塞项。运行时重启后，尚未协调解决的准备恢复记录会继续阻止完成。

## 参数与结果

所有操作支持 `--format text|json`、`--project`、运行时 `--context` 或 `--url`，以及通用配置和过滤参数。移除流程中应保持运行时一致。

- `--project-owner <绝对文件路径>` 选择当前会话或工作代理的私有凭证；每次 CLI 调用均需保留。不要向工作代理传递父会话凭证。
- `--wait-ms <0–60000>` 指定排空等待上限，省略时立即返回当前状态。超时后准入保持关闭。
- `drain`、`resume` 必须选择恰好一个目录。`release`、`status` 支持 `--project-set` 中显式选择的成员，分别返回结果；未解析的选择会被拒绝。

JSON 输出包含 `results` 数组，每项包含 `checkoutPath`、`admission`（`open` 或 `draining`）、`complete`、`blockers`。HTTP 成功或接受排空请求不代表完成清理。

`status` 在检查成功时退出码为零，即使仍有阻塞。`drain` 仅在选定结果均完成时退出码为零；等待中、阻塞、超时和错误均返回非零。`release` 在目录仍未完成清理时也返回非零。使用 `--format json` 时，命令错误遵循 CLI 的结构化错误格式。

关闭状态在运行时重启，以及规范化路径被删除后重新创建时仍然保留，必须显式执行 `resume`。重复执行释放、排空和恢复不会删除已准备的索引或配置。

## 管理器移除流程

1. 每个会话或工作代理使用自己的 bootstrap 凭证释放选定绑定。
2. 操作员在同一运行时针对一个目录执行 `project drain`。
3. 同时要求退出码为零且 `complete: true`。否则检查阻塞项，等待已准入工作完成，并在有限预算内重复检查或排空。
4. 工作树管理器检查其他进程和运行时，再使用自己的移除命令删除检出目录。

1MCP 不删除目录或产物、不终止无关进程，也不保证整个机器上无人使用该目录。放弃移除时，应先执行 `project resume` 再恢复使用。

## 会话与工作代理钩子

[CLI 设置](/zh/commands/cli-setup) 安装启动所有权接入和 `SessionEnd` 清理。Bootstrap 为每个会话和工作代理提供独立凭证路径，后续调用必须保留 `--project-owner`。结束清理仅处理该所有者记录过的运行时和目录选择。

`Stop`、`SubagentStop` 不是可靠的工作代理终止事件，不会释放所有权。工作代理完成分配任务后应显式释放；目前尚无已验证的自动工作代理终止覆盖。不支持的客户端、不支持命令钩子的云端编排、禁用或未信任的钩子、遗漏所有者参数、运行时故障及钩子超时均为覆盖缺口。空闲过期仍用于崩溃和遗漏钩子的恢复，但不代表可以移除目录。

事件语义参见 [Codex 钩子](https://learn.chatgpt.com/docs/hooks)和 [Claude Code 钩子](https://code.claude.com/docs/en/hooks)。仅安装配置不能证明真实客户端已成功执行钩子。
