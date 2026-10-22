---
title: 项目 Checkout、项目集合与 Worker 分配
description: 显式选择源码 checkout 和已保存的项目集合，区分配置继承来源，并为 Codex 或 Claude worker 分配目标。
---

# 项目 Checkout、项目集合与 Worker 分配

从设置到清理的完整流程，参见[跨项目与 Git Worktree 工作指南](/zh/guide/worktrees-and-cross-project-sessions)。

下方示例使用已验证启动钩子的受支持 Codex 会话：1MCP 自动解析所有者和已分配项目。Claude 或不支持自动查找所有者的宿主需添加 `--project-owner <own-file>`，使用该调用方自己的 bootstrap 凭证；worker 也使用自己的凭证。示例中的显式项目参数用于覆盖目标、选择其他检出目录。设置与回退方式见 [CLI setup](/zh/commands/cli-setup)。

一个 agent 跨仓库或 Git worktree 工作时，用显式参数为每次调用选择源码 checkout，由共享的本地运行时管理连接。项目选择不会修改运行时全局的“当前项目”，也不会自动把同一个工具调用分发给所有成员。

工具契约未变化时，可在当前会话内复用已知的工具参数结构，包括跨项目调用。项目专属指令、就绪状态、授权和目标选择仍需保持有效。信息缺失、能力变化、准备完成或发生相关失败时，应重新检查服务器和工具。不得自动重放失败的工具调用。

`--project` 和 `--project-set` 仅适用于 `bootstrap`、`instructions`、`inspect`、`run`、`proxy`、`wait`、除 `recover` 外的项目生命周期命令，以及项目准备命令。每个 `--project` 只接收一个值；选择多个项目集标签时重复该参数。参数可放在支持它的命令之前或之后，例如 `1mcp --project /work/app inspect codegraph`。其他命令（包括 `serve` 和 `project recover`）会在执行前拒绝这些参数。

## 项目与所有者选项

以下选项适用于 `instructions`、`inspect`、`run` 以及项目准备和生命周期命令：

| 选项                        | 含义                                                                           |
| --------------------------- | ------------------------------------------------------------------------------ |
| `--project <path-or-label>` | 选择一个检出路径，或项目集合中的成员标签。仅在操作支持多个成员时重复传入标签。 |
| `--project-set <file>`      | 加载保存的 JSON 项目集合；成员的相对路径从该文件所在目录解析。                 |
| `--project-owner <file>`    | 需要覆盖自动所有者查找时，使用当前调用方自己的 bootstrap 私有凭证。            |

保持运行时和筛选条件一致。受支持的 Codex 会话对已分配默认项目的调用无需项目或所有者参数。单次项目覆盖不会改变默认目标；发现、检查、准备和调用期间应保留该覆盖。所有者凭证标识调用方，不负责选择目录，也不替代运行时认证。远程运行时不支持本地所有者凭证。覆盖默认目标时，动态模板和检出目录相关调用应保留项目选择参数；静态且与项目无关的服务器及 schema 检查不需要这些参数。

## 源码 Checkout 与配置来源

**Project Checkout** 是后端应查询的源码目录。**Project Configuration Source** 提供 preset、标签过滤等默认值。二者可以来自不同目录：

| Checkout                    | 使用的配置                                | 查询的源码    |
| --------------------------- | ----------------------------------------- | ------------- |
| 有 `.1mcprc` 的主 checkout  | 主 checkout 的文件                        | 主 checkout   |
| 没有本地文件的关联 worktree | 同一 Git 仓库的主 checkout 文件（可用时） | 当前 worktree |
| 有本地文件的关联 worktree   | 完整使用本地文件                          | 当前 worktree |

本地文件整体替换继承配置；缺失字段不会从主 checkout 合并。例如，worktree 中只有 `{"tags":["frontend"]}` 的文件不会同时继承主 checkout 的 preset。主 checkout 配置不可用时，关联 checkout 仍然是源码目标。

自动发现仅在当前仓库边界内查找，不会隐式选用仓库上方的配置。嵌套目录中的调用仍可找到本仓库内的配置。检查结果时区分源码身份与配置来源：共享 Git 历史或继承设置都不能证明另一个 checkout 的索引覆盖了当前源码。

## 使用已分配的检出目录

受支持的 Codex 会话在普通调用中使用根会话经验证的启动项目，或 worker 通过 bootstrap 显式分配的目标：

```bash
1mcp inspect codegraph
1mcp inspect codegraph/codegraph_explore
1mcp run codegraph/codegraph_explore --args '{"query":"Where are the API routes defined?"}'
```

改变 shell 的 cwd 不会改变会话默认目标。未接入宿主时，普通 CLI 调用使用 cwd。Worker 在项目相关调用前仍需获得显式分配。分配了多个项目的集合时，单检出目录工具需要选择成员，例如 `--project backend`。

## 选择单个 Checkout

不使用项目集合而要覆盖已分配默认目标时，传入一个 checkout 路径：

```bash
1mcp instructions --project /work/frontend
1mcp inspect --project /work/frontend
1mcp inspect codegraph --project /work/frontend
```

普通 CLI 路径可相对于调用目录，最终解析为可读取、可进入的规范目录。现有单 checkout 调用可继续省略 `--project`，使用自动发现的默认目标。派发给 worker 的路径应使用绝对路径，避免父任务的调用目录影响选择。

每次 `instructions`、`inspect` 和 `run` 调用都保留目标参数。调用前阅读适用的服务器指令；工具参数结构未知时先执行检查：

```bash
1mcp inspect codegraph/codegraph_explore --project /work/frontend
1mcp run codegraph/codegraph_explore --project /work/frontend --args '{"query":"Checkout-specific symbol"}'
```

示例要求已配置并可使用对应服务器和工具。目标选择仍受运行时原有身份验证、授权和模板上下文信任要求约束。

## 保存项目集合

创建 JSON 定义，例如 `/work/feature-projects.json`：

```json
{
  "name": "feature",
  "projects": [
    { "label": "frontend", "path": "./frontend" },
    { "label": "backend", "path": "./backend-worktree" }
  ]
}
```

`name` 可省略。集合包含 1–32 个成员，标签必须唯一且不超过 128 字符，路径不超过 4,096 字符；文件上限为 64 KiB。成员的相对路径以定义文件所在目录为基准，各成员必须解析为可读取、可进入的目录。保存文件不会切换全局项目，各会话独立显式选择它。

按标签选择成员：

```bash
1mcp instructions --project-set /work/feature-projects.json --project frontend
1mcp inspect --project-set /work/feature-projects.json --project backend
```

定义可包含默认 `"selection": ["backend"]`。CLI `--project` 标签覆盖已保存的选择；重复传入时保留指定顺序：

```bash
1mcp inspect --project-set /work/feature-projects.json --project backend --project frontend
```

单成员集合默认选择该成员。多成员集合既没有已保存的 `selection`、也没有显式标签时，checkout 选择未解决。Checkout 专属操作要求先选择目标，并报告可选标签；与项目无关的工具不需要选择。未知标签或重复选择会被拒绝。

## 匹配后端的目标契约

运行时服务器配置可声明 `projectTarget` 元数据：

| 模式          | 目标选择与工具参数                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `single`      | 选择一个 checkout。配置的 `argument` 接收其路径；未配置参数时，由绑定到目标的模板提供 checkout 上下文。 |
| `native-set`  | 上游工具原生支持同时接收多个 checkout。必填的 `argument` 接收有序路径数组。                             |
| `independent` | 后端不需要 checkout 目标，不注入项目参数。                                                              |

例如，上游 schema 支持 `projects` 数组时，可配置：

```json
{ "projectTarget": { "mode": "native-set", "argument": "projects" } }
```

元数据必须匹配上游 schema；声明它不能让单项目后端自动支持多项目。模板默认 `single`，静态服务器默认 `independent`。声明为 `single` 的静态服务器需要明确的目标参数，或改为绑定目标的模板。工具参数与显式选择的目标冲突时会拒绝调用。

单项目后端由 agent 为不同标签分别调用。原生组合调用则一起选择所需标签，且后端必须在每个选中 checkout 的有效 preset/过滤设置下都允许使用。选择目标不会扩大身份验证或授权范围。并发目标在需要时使用独立的预备绑定，上游可变的活动项目状态必须保持隔离。

## 显式分配每个 Worker

每个派发任务的指令中都写明绝对 checkout 路径，或项目集合定义文件的绝对路径及所选标签。例如：

> 你的 Worker Project Assignment 是 `/work/feature-projects.json` 中的 `backend` 标签。获取项目指令或发现工具前，先执行 `1mcp bootstrap --client codex --event SubagentStart --project-set /work/feature-projects.json --project backend`。Bootstrap 将该分配记录为 worker 的默认目标，后续调用可省略这些参数。

多个成员的分配可重复传入 `--project`；单项目调用每次选择一个标签，支持原生组合调用时一起选择所需标签。Claude 使用 `--client claude` 并添加该 worker 自己的 bootstrap `--project-owner <own-file>`。

[`cli-setup`](/zh/commands/cli-setup) 为指定客户端和范围配置受管理的 `SessionStart` 与 `SubagentStart` 钩子。`SessionStart` 可获取普通会话的运行时指令；每个 worker 独立收到 inspect-before-run 指引。官方客户端钩子载荷提供身份和 cwd，但没有项目分配字段，因此 worker 通过派发指令及显式 bootstrap 调用取得分配。

未分配目标的 `SubagentStart` 只提供通用指引并报告选择未解决，不会根据 cwd 或会话身份选择父 checkout。全局与仓库钩子可能同时交付内容；重复交付不会抑制另一个 worker 的目标指令。

Bootstrap 要求显式 CLI 分配参数；其参数解析忽略继承的 `ONE_MCP_*` 选项，获取指令的子进程去除继承的 `ONE_MCP_PROJECT` 和 `ONE_MCP_PROJECT_SET`，不修改父进程环境。其它命令的普通项目选择保留原有选项行为。

## 调用工具前确认覆盖范围

生成钩子文件不证明钩子已经启用、被信任或实际执行，应检查客户端在两个事件中实际收到额外上下文。禁用或未信任的钩子、运行时指令不可用、钩子输入超限、分配未解决都属于引导覆盖缺口。有效的显式项目分配和成功获取的指令均完整交付。运行时指令超过 9,000 字符时会附加建议，要求 agent 推荐用户在未来会话中使用 preset 选择更少的服务器，不会省略或截断指令。

依赖结果前检查所选 checkout 的后端证据。后端已连接、bootstrap 成功或另一个 checkout 有索引，都不证明当前源码的索引覆盖情况。本指南说明目标选择与引导，后端准备另需适用策略和就绪检查。

另见 [CLI 模式](/zh/guide/integrations/cli-mode)、[配置](/zh/guide/essentials/configuration) 和 [CLI setup](/zh/commands/cli-setup)。
