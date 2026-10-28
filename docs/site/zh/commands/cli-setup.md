---
title: CLI Setup 命令
description: 为 Codex 或 Claude 安装 1MCP CLI 模式的引导文档和 hooks。
---

# CLI Setup 命令

客户端钩子运行 `bootstrap`，建立所有权并通过 `instructions` 获取指引。智能体仅在缺少当前指引或需要刷新时单独运行 `instructions`；它不会创建所有者凭证。完整流程见[启动工作流](/zh/guide/worktrees-and-cross-project-sessions)。

从设置到清理的完整流程，参见[跨项目与 Git Worktree 工作指南](/zh/guide/worktrees-and-cross-project-sessions)。

为 Codex 或 Claude 安装 1MCP CLI 的引导文档和钩子配置。

工具契约未变化时，可在当前会话内复用已知的工具参数结构，包括跨项目调用。项目专属指令、就绪状态、授权和目标选择仍需保持有效。信息缺失、能力变化、准备完成或发生相关失败时，应重新检查服务器和工具。不得自动重放失败的工具调用。

## 概要

```bash
1mcp cli-setup (--codex | --claude) [选项]
```

## 描述

`cli-setup` 会安装轻量级引导文件，让 Codex 或 Claude 会话按 1MCP CLI 工作流启动。它会写入：

- 受管理的 `1MCP.md` 引导文档
- 受管理的 `SessionStart`、`SubagentStart` 引导命令钩子及 `SessionEnd` 调用方清理
- 从 `AGENTS.md` 或 `CLAUDE.md` 指向启动文档的引用
- `1mcp-preparation-setup` 技能及其后端参考说明

`cli-setup` 不会替代 [`instructions`](/zh/commands/instructions)。它的作用是确保会话准备好按正确顺序使用 `instructions`、`inspect` 和 `run`。

可以把 `cli-setup` 理解为把现有 agent 工作流迁移到 1MCP CLI 模式的桥。它负责教客户端怎么开始，但真正的实时发现和执行仍然通过 `instructions`、`inspect`、`run` 完成。

## 必选客户端

必须且只能选择一个目标：

- **`--codex`** - 仅为 Codex 安装
- **`--claude`** - 仅为 Claude 安装

如果两个都不传或同时传入，命令会报错。

## 选项

- **`--scope <global|repo|all>`** - 安装范围，默认 `global`
- **`--repo-root <path>`** - repo 级安装时使用的仓库根目录

## 范围行为

- **`global`** - 写入用户 home 目录下的 Codex 或 Claude 配置位置
- **`repo`** - 在指定仓库内写入 repo-local 配置
- **`all`** - 同时写入全局与 repo 级配置

## 写入的文件

### Codex

- 全局受管理文档：`~/.codex/1MCP.md`
- 全局 hooks：`~/.codex/hooks.json`
- 全局启动引用：`~/.codex/AGENTS.md`
- Repo 受管理文档：`<repo>/.codex/1MCP.md`
- Repo hooks：`<repo>/.codex/hooks.json`
- Repo 启动引用：`<repo>/AGENTS.md`

### Claude

- 全局受管理文档：`~/.claude/1MCP.md`
- 全局 hooks：`~/.claude/settings.json`
- 全局启动引用：`~/.claude/CLAUDE.md`
- Repo 受管理文档：`<repo>/.claude/1MCP.md`
- Repo hooks：`<repo>/.claude/settings.json`
- Repo 启动引用：`<repo>/CLAUDE.md`

## 准备配置技能

每次运行 `cli-setup` 都会为选定客户端和范围安装准备配置技能：

| 客户端 | 全局                                       | 仓库                                            |
| ------ | ------------------------------------------ | ----------------------------------------------- |
| Codex  | `~/.agents/skills/1mcp-preparation-setup/` | `<repo>/.agents/skills/1mcp-preparation-setup/` |
| Claude | `~/.claude/skills/1mcp-preparation-setup/` | `<repo>/.claude/skills/1mcp-preparation-setup/` |

Codex 在两种作用域下均使用共享的 `.agents/skills` 目录，其他从该目录发现技能的智能体也可读取同一份安装。Claude 继续使用原生的 `.claude/skills` 目录。现有 `.codex/skills` 中的副本会保留；如果安装过早期预览版本，请确认共享技能已被发现后，检查并手动移除重复副本。

可以对智能体说：“使用 1mcp-preparation-setup 技能，为我的 CodeGraph worktree 配置准备流程。”请求配置后端准备时，智能体也可自动选择此技能。技能支持复用已有配方，也可帮助编写并验证缺失的配方。CodeGraph、Code Review Graph 和 Serena 的参考说明依赖具体版本，并非内置的生产配方。

已安装的 npm 包或独立二进制均可离线安装该技能。安装不会启用准备、安装后端依赖或修改 `mcp.json`。启用与验证流程见[后端准备](/zh/guide/backend-preparation)。

再次运行 `cli-setup` 可更新技能。输出区分 `installed`、`updated`、`unchanged` 和 `conflict`。技能目录内的 `.1mcp-managed.json` 记录受管理文件的哈希。未被修改的受管理文件可更新；本地修改、已删除的受管理文件、来源未知的同名安装和符号链接目标会被保留并报告冲突，其他设置文件仍会完成。解决冲突前请单独保存自定义技能，将冲突技能目录移出安装位置后重新运行设置。无关文件会被保留。

安装锁防止多个安装进程同时写入。更新中断后，日志支持续传，不会将安装程序已经写入的内容误判为本地修改。若日志中的新增文件缺失，安装器无法区分写入中断和用户删除，因此会保留文件缺失状态并报告冲突。如果终止的进程在技能旁留下 `.install-lock` 目录，请先确认没有安装程序运行，再移走该锁并重新执行设置。不要移除仍在运行的安装程序的锁。

## 示例

### 安装全局 Codex 配置

```bash
1mcp cli-setup --codex
```

### 安装 Repo 级 Claude 配置

```bash
1mcp cli-setup --claude --scope repo --repo-root .
```

### 同时安装全局和 Repo 级 Codex 配置

```bash
1mcp cli-setup --codex --scope all
```

## Codex 后续配置

当使用 `--codex` 时，命令还会输出一段必须加入 `config.toml` 的配置，用于开启 Codex hooks，以及带网络访问的 `workspace-write` 沙箱。

## 最终工作流

受管理的启动文档会告诉客户端：

1. 如果当前会话尚未通过 hooks 注入最新内容，就先执行 `1mcp instructions`
2. 不知道提供方或工具时，可先执行 `1mcp inspect --search <query>`（也可指定服务器）；已知目标时跳过发现步骤
3. 缺少服务器指令时执行 `1mcp instructions <server>`，并阅读适用的服务器指令
4. 工具参数结构未知时执行 `1mcp inspect <server>/<tool>`
5. 只有在确认 schema 之后才执行 `1mcp run <server>/<tool> --args '<json>'`

搜索默认使用不区分大小写的字面子串匹配。使用带引号的 `--search 'filesystem/*read?' --glob` 可按 `*`/`?` 对整个引用匹配。`--include-descriptions` 将有效描述纳入匹配；`--show-descriptions` 独立控制描述显示。

重新运行相同的 `cli-setup` 命令即可更新任意范围的受管理指引。重复执行保持文件字节稳定，并保留无关的启动文档内容和 hooks，包括与受管理命令混在同一条目中的自定义命令。完全匹配的旧 `1mcp instructions` 钩子会替换为两个事件各自的无条件 `1mcp bootstrap --client <client> --event <event>` 钩子；带额外参数的自定义命令仍由用户管理。全局和仓库钩子可能重复交付指引，重复交付不会抑制另一个目标的 worker 指令。

## Worker 引导与项目分配

`bootstrap` 从 stdin 读取客户端钩子 JSON，为指定事件输出 `hookSpecificOutput.additionalContext`。[Codex](https://learn.chatgpt.com/docs/hooks) 和 [Claude](https://code.claude.com/docs/en/hooks) 均支持该格式。stdin 上限为 64 KiB，等待期限为一秒；运行时指令获取期限为五秒。成功获取的指令会完整交付，不再设置子进程输出大小上限或上下文大小截断。输入无效或运行时失败时仍交付通用指引并报告覆盖缺口，不声称已经交付完整项目指令。

当渲染后的运行时指令超过 9,000 字符（按 JavaScript 字符串长度计算）时，bootstrap 会附加一条建议，要求 agent 简短告知用户，并推荐使用 1MCP preset 在未来会话中选择更少的相关 MCP 服务器，例如 `1mcp instructions --preset <name>`。该阈值不包含静态指引和序列化后的项目分配。所有指令和有效项目分配均完整保留；agent 继续当前任务，不自动修改配置。指令长度小于或等于阈值时不附加建议。

`SessionStart` 可获取普通会话的运行时指令。`SubagentStart` 没有明确分配时，只交付 inspect-before-run 指引并报告项目选择未解决；不会用钩子 cwd 或父会话身份选择父 checkout。客户端官方钩子 schema 没有 worker 项目分配字段。

Bootstrap 从显式 CLI 参数解析选项，不使用继承的 `ONE_MCP_*` 选项。获取指令的子进程去除继承的 `ONE_MCP_PROJECT` 和 `ONE_MCP_PROJECT_SET`，保留其它环境传递。父任务的环境目标参数不会给未分配的 worker 自动指定目标。

在派发任务的上下文中，为每个 worker 写明绝对 checkout 路径或项目集合定义文件的绝对路径。Worker 在获取项目指令或调用工具之前执行其中一种命令：

在 Claude 示例中，将 `/private/your-worker-owner.json` 替换为该 worker 自己的启动凭证，不能复用父会话凭证。

```bash
1mcp bootstrap --client codex --event SubagentStart --project /absolute/frontend-checkout
1mcp bootstrap --client claude --event SubagentStart --project-owner /private/your-worker-owner.json --project-set /absolute/feature-projects.json --project backend
1mcp bootstrap --client codex --event SubagentStart --project-set /absolute/feature-projects.json --project backend --project frontend
```

不使用项目集合时，只分配一个绝对 checkout 路径。使用 `--project-set` 时，可重复传入 `--project` 选择有序成员标签，并覆盖定义中可选的 `selection`。受支持的 Codex 宿主在手动重试时通过已有私有线程定位记录解析所有者，无需所有者参数。Bootstrap 将工作代理分配记录为默认目标，后续 `instructions`、`inspect` 和 `run` 调用可省略项目参数。单次覆盖不会改变默认目标。多个项目的分配要求对 checkout 专属工具明确选择 checkout；单项目工具由 agent 协调分别调用。获取指令时参数通过 argv 传递，不经过 shell。定义格式和后端目标契约参见 [项目 Checkout 与集合](/zh/guide/project-checkouts)。

## 验证钩子交付

引导覆盖缺口包含稳定的原因分类。`invalid_hook_input` 表示钩子输入不完整、无效或事件不匹配；`invalid_assignment` 表示客户端、事件或项目选择无效；`assignment_unresolved` 表示工作代理仍缺少明确分配的目标。修正后再运行 bootstrap。`instructions_timeout`、`instructions_unavailable`、`instructions_failed` 和 `instructions_empty` 分别标识指令子进程超时、不可用、执行失败和输出为空。检查运行时可用性，再使用相同分配、运行时和筛选条件运行 `1mcp instructions`。诊断不会回显钩子输入、子进程标准错误或任意异常文本。这些分类仅描述指令交付，不证明所有权清理或后端就绪。

生成钩子配置不证明客户端已经启用或信任它、钩子实际执行、运行时可用或目标 checkout 索引就绪。应检查客户端在两个事件中实际收到 `additionalContext`。禁用或未信任的钩子、因包含注释而保留未修改的配置、运行时失败和未解决的 worker 分配都属于引导覆盖缺口。项目工具调用前先解决缺口；setup 不会自动开启钩子或修改信任设置。

## 另请参阅

- **[CLI 模式指南](/zh/guide/integrations/cli-mode)** - 面向 agent 的 CLI 工作流概念说明
- **[Instructions 命令](/zh/commands/instructions)** - `cli-setup` 最终引导会话进入的命令
- **[Inspect 命令](/zh/commands/inspect)** - 发现工具和查看 schema
- **[Run 命令](/zh/commands/run)** - 调用选中的工具
- **[Codex 集成指南](/zh/guide/integrations/codex)** - Codex 的完整配置流程

## 准备工作指引

托管的 `SessionStart` 和 `SubagentStart` hooks 调用 `1mcp bootstrap`。Bootstrap 传递托管操作指引，并在目标已解析时获取运行时指令。指引包含 [project prepare 工作流](/zh/commands/project/prepare)：检查就绪状态、请求已授权的准备工作、监控任务、验证就绪状态、刷新发现结果，然后重新发起工具调用。工作智能体的项目分配未解析时，必须先恢复分配，再执行项目相关的准备操作。

Setup 只安装指引，不会启动准备工作、启用自动准备或更改操作权限。保留 bootstrap hooks。若 hooks 已传递当前指令，则无需重复获取；否则使用独立的 `1mcp instructions` 入口。重新运行 `cli-setup` 可刷新所选范围内的托管指引。

## 会话默认目标与清理

启动钩子为每个已验证会话和工作代理创建独立私有凭证。Codex 钩子写入精确私有线程定位记录，后续调用通过 `CODEX_THREAD_ID`（当前代理）查找记录及已有凭证，支持未提供 `CODEX_SESSION_ID` 的工作代理 shell。若提供 `CODEX_SESSION_ID`（根会话），必须与钩子记录一致；同时提供两个标识时也可直接定位旧版凭证。正常调用无需 `--project-owner` 或 `--project`：

```bash
1mcp instructions
1mcp inspect <server>
1mcp inspect <server>/<tool>
1mcp run <server>/<tool> --args '{}'
```

根会话保留通过钩子 cwd 或显式启动参数解析的初始项目；工作代理保留显式派发分配。改变 shell cwd 或单次使用 `--project /another/worktree` 不改变会话默认目标。未接入宿主身份的普通 CLI 仍使用 cwd。分配的项目集合在通过 `--project <label>` 选择成员前保持未解析状态，选择成员不会扩大工具可见范围。

Claude 以及既无可信线程定位记录、也无完整双标识接入的 Codex 宿主，需要在后续调用及手动 bootstrap 重试中保留钩子提供的 `--project-owner <own-file>`。将上例 `/private/your-worker-owner.json` 替换为自己的钩子凭证路径。不得使用父会话凭证或伪造钩子身份；没有凭证时先解决受信任钩子交付缺口。环境标识仅定位已有凭证，不会创建凭证或授权远程生命周期控制。保持签发凭证时的配置目录；切换本地运行时范围时可显式指定自己的凭证路径。

新会话将私有凭证、分配、锁和释放记录写入 `<os-temp>/1mcp-owners-<user-and-config-hash>/project-owners`。系统临时目录由 Node.js `os.tmpdir()` 决定；钩子和 CLI 调用必须使用相同的临时目录与配置目录。目录仅所有者可访问（`0700`），凭证文件权限为 `0600`。运行时配置保留原位置。已有会话继续使用原来的 `<config-dir>/project-owners` 记录直到验证清理完成；不要复制或移动活跃凭证。使用更新后的 CLI 启动新会话即可使用临时存储。系统清理或重启可能丢失临时记录；记录缺失不能证明运行时已释放所有权。权限错误、不完整或冲突的记录会阻止调用。完全没有钩子记录时，普通调用使用 cwd 并输出所有权覆盖缺口提示。Setup 不扩大沙箱权限。

已验证的根会话 `SessionEnd` 仅释放该所有者记录的选择。每个目标确认安全释放该所有者后，删除其凭证、线程定位记录、分配、选择快照和目标记录，保护其他所有者及共享资源。重复结束清理是安全的。释放等待中、失败或结果不确定时保留凭证及终止日志，可有限重试：

```bash
1mcp project recover --project-owner /private/ended-session-owner.json
```

恢复仅使用记录目标并验证运行时身份，必须已有受验证的终止记录。仅凭记录年龄、父任务消失、`Stop` 或 `SubagentStop` 不能证明会话不再活动。终止钩子执行前崩溃的记录保留供检查，不自动扫描删除；遗留锁也须先检查，不得删除活动进程的锁。

目前不支持工作代理终止事件；`SubagentStop` 后工作代理仍可能继续。完成任务时工作代理显式执行 `1mcp project release`；手动释放保留凭证以便继续使用。普通回合结束不释放或删除活动所有者状态。钩子缺失、不支持的客户端、钩子超时和权限失败仍是明确覆盖缺口。释放结果、阻塞项与移除流程参见 [Project 生命周期](/zh/commands/project/)。
