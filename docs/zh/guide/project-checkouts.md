---
title: 项目 Checkout、项目集合与 Worker 分配
description: 显式选择源码 checkout 和已保存的项目集合，区分配置继承来源，并为 Codex 或 Claude worker 分配目标。
---

# 项目 Checkout、项目集合与 Worker 分配

一个 agent 跨仓库或 Git worktree 工作时，用显式参数为每次调用选择源码 checkout，由共享的本地运行时管理连接。项目选择不会修改运行时全局的“当前项目”，也不会自动把同一个工具调用分发给所有成员。

## 源码 Checkout 与配置来源

**Project Checkout** 是后端应查询的源码目录。**Project Configuration Source** 提供 preset、标签过滤等默认值。二者可以来自不同目录：

| Checkout                    | 使用的配置                                | 查询的源码    |
| --------------------------- | ----------------------------------------- | ------------- |
| 有 `.1mcprc` 的主 checkout  | 主 checkout 的文件                        | 主 checkout   |
| 没有本地文件的关联 worktree | 同一 Git 仓库的主 checkout 文件（可用时） | 当前 worktree |
| 有本地文件的关联 worktree   | 完整使用本地文件                          | 当前 worktree |

本地文件整体替换继承配置；缺失字段不会从主 checkout 合并。例如，worktree 中只有 `{"tags":["frontend"]}` 的文件不会同时继承主 checkout 的 preset。主 checkout 配置不可用时，关联 checkout 仍然是源码目标。

自动发现仅在当前仓库边界内查找，不会隐式选用仓库上方的配置。嵌套目录中的调用仍可找到本仓库内的配置。检查结果时区分源码身份与配置来源：共享 Git 历史或继承设置都不能证明另一个 checkout 的索引覆盖了当前源码。

## 选择单个 Checkout

不使用项目集合时，只能传入一个 checkout 路径：

```bash
1mcp instructions --project /work/frontend
1mcp inspect --project /work/frontend
1mcp inspect codegraph --project /work/frontend
```

普通 CLI 路径可相对于调用目录，最终解析为可读取、可进入的规范目录。现有单 checkout 调用可继续省略 `--project`，使用自动发现的默认目标。派发给 worker 的路径应使用绝对路径，避免父任务的调用目录影响选择。

每次 `instructions`、`inspect` 和 `run` 调用都保留目标参数。调用前先检查服务器指令和工具 schema：

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

> 你的 Worker Project Assignment 是 `/work/feature-projects.json` 中的 `backend` 标签。获取项目指令或发现工具前，先执行 `1mcp bootstrap --client codex --event SubagentStart --project-set /work/feature-projects.json --project backend`。后续 instructions、inspect 和工具调用保留这些目标参数。

多个成员的分配可重复传入 `--project`；单项目调用每次选择一个标签，支持原生组合调用时一起选择所需标签。Claude 使用 `--client claude`。

[`cli-setup`](../commands/cli-setup.md) 为指定客户端和范围配置受管理的 `SessionStart` 与 `SubagentStart` 钩子。`SessionStart` 可获取普通会话的运行时指令；每个 worker 独立收到 inspect-before-run 指引。官方客户端钩子载荷提供身份和 cwd，但没有项目分配字段，因此 worker 通过派发指令及显式 bootstrap 调用取得分配。

未分配目标的 `SubagentStart` 只提供通用指引并报告选择未解决，不会根据 cwd 或会话身份选择父 checkout。全局与仓库钩子可能同时交付内容；重复交付不会抑制另一个 worker 的目标指令。

Bootstrap 要求显式 CLI 分配参数；其参数解析忽略继承的 `ONE_MCP_*` 选项，获取指令的子进程去除继承的 `ONE_MCP_PROJECT` 和 `ONE_MCP_PROJECT_SET`，不修改父进程环境。其它命令的普通项目选择保留原有选项行为。

## 调用工具前确认覆盖范围

生成钩子文件不证明钩子已经启用、被信任或实际执行，应检查客户端在两个事件中实际收到额外上下文。禁用或未信任的钩子、运行时指令不可用、输入输出超限、分配未解决都属于引导覆盖缺口。转义后过大的分配会整体省略，应从派发指令恢复原始目标参数。

依赖结果前检查所选 checkout 的后端证据。后端已连接、bootstrap 成功或另一个 checkout 有索引，都不证明当前源码的索引覆盖情况。本指南说明目标选择与引导，后端准备另需适用策略和就绪检查。

另见 [CLI 模式](./integrations/cli-mode.md)、[配置](./essentials/configuration.md) 和 [CLI setup](../commands/cli-setup.md)。
