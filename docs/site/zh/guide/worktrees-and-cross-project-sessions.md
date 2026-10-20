---
title: 跨项目与 Git Worktree 工作指南
description: 配置本地智能体会话，在前后端检出目录间协作，分配独立 worker，准备后端并安全释放 worktree。
---

# 跨项目与 Git Worktree 工作指南

当一个功能涉及多个仓库或 Git worktree 时，使用本指南。示例将前端保留在 `/work/frontend`，从 `/work/backend` 创建功能 worktree，并为每个 worker 指定明确目标。一个本地 1MCP 运行时管理后端连接。

## 每一步由谁执行？

**你**负责安装工具、配置运行时和客户端，并选择项目及准备权限。**AI 智能体**在 bootstrap 后执行发现、工具调用、准备控制，以及释放自身绑定。**本地操作者或 worktree 管理器**负责排空、移除或恢复检出目录。如果你已授权相应工作，且智能体具有所需的本地权限，也可以由它执行操作者步骤。

下方命令块标明了预期执行者。标为 **AI 智能体** 的命令用于展示智能体的工作流程，无需你手动重复执行。启动钩子由客户端自动运行；显式 worker bootstrap 示例由 worker 执行，用来解析它的项目分配。

## 1. 安装后端并使用 `mcp setup` 配置

你需要 Git、支持命令钩子的本地 Codex 或 Claude Code，以及包含项目选择和 `project` 生命周期命令的 1MCP 构建。按照[安装指南](/zh/guide/installation)安装，然后检查：

**你——设置**

```bash
1mcp --version
1mcp project --help
1mcp project prepare --help
```

如果缺少这些命令，请安装包含它们的构建，参见[安装指南](/zh/guide/installation)。确保智能体调用的 `1mcp` 和本地运行时使用同一构建。

示例使用 Linux/macOS 上的 Bash 或 Zsh。将 `/work` 替换为自己的绝对工作目录。Windows 用户需要调整 shell 语法；自动准备和后端退出验证还有额外限制，见相关参考文档。

先按后端自身的安装说明安装所需工具及语言依赖。本指南以 CodeGraph 为例，但项目选择功能并不要求使用它。将已安装的可执行文件配置为可复用模板：

**你——设置**

```bash
1mcp mcp setup --known codegraph --dry-run
1mcp mcp setup --known codegraph
```

Setup 在 `mcp.json` 的 `mcpTemplates` 中保存可复用的 `codegraph` 条目，每次调用将其绑定到所选检出目录。不要添加 `--checkout`，该选项会创建固定目标。如果可执行文件不在 PATH 中，为两个命令添加 `--executable /absolute/path/to/codegraph`。

Linux/macOS 的默认文件为 `~/.config/1mcp/mcp.json`，Windows 为 `%APPDATA%/1mcp/mcp.json`。如果使用 `--config` 或 `--config-dir`，向 setup 和运行时传入同一选项。Setup 不会安装后端或初始化索引。其他维护中的后端、命名及重新配置选项见 [mcp setup](/zh/commands/mcp/setup)。

如果本地运行时尚未启动，在另一个终端运行：

**你——设置**

```bash
1mcp serve
```

全程使用同一运行时和配置。后续示例使用默认的本地发现；如果使用 `--context` 或 `--url`，请在 bootstrap、发现、准备和清理期间保留同一选项。现有认证和项目访问要求仍然适用。

## 2. 启用客户端工作流

选择对应客户端的命令：

**你——设置**

```bash
1mcp cli-setup --codex
# 或者使用 Claude Code：
1mcp cli-setup --claude
```

这些命令安装全局 bootstrap 指引和钩子。仓库级配置见 [CLI setup](/zh/commands/cli-setup)。Codex 用户还需要应用 setup 输出的钩子和沙箱配置片段。在客户端启用并信任这些钩子，然后启动新会话。此流程使用 [CLI 模式](/zh/guide/integrations/cli-mode)，请移除同一客户端作用域中重复的直连 1MCP MCP 配置。

确认启动时实际收到 1MCP 操作指引和私有 `--project-owner` 凭证路径。仅存在钩子文件不能证明已经执行。Worker 也需要自己的启动上下文和凭证。缺少任一项时，先解决报告的钩子或运行时错误；不要自行构造凭证文件，也不要复制父会话凭证。

在每个会话的 shell 中，将下面的便捷变量设为**该会话 bootstrap 输出的实际绝对凭证路径**：

**AI 智能体**

```bash
SESSION_OWNER='/absolute/path/from/this-sessions-bootstrap.json'
```

变量仅用于简化示例。如果工具调用使用独立 shell，每次都直接传入实际路径。不要提交或共享凭证。后续所有 1MCP 调用都保留它，包括 bootstrap 重试。

### `bootstrap` 与 `instructions`：应该运行哪个？

客户端钩子运行 `bootstrap`，创建调用方的所有者凭证，并通过 `instructions` 获取运行时指引。智能体收到当前目标的指引后，继续执行 `inspect` 和 `run`；仅在缺少指引或需要刷新时运行 `instructions`。缺少凭证时应修复钩子交付，`instructions` 不会创建凭证。生命周期事件和手动 bootstrap 重试见 [CLI setup](/zh/commands/cli-setup)。

### 为什么要保留 `--project-owner`？

`--project` 选择检出目录，`--project-owner` 标识使用它的会话。每个 worker 保留自己从 bootstrap 获得的凭证，释放自身绑定时才能保留其他 worker 的工作。不要将父会话凭证复制给 worker。该凭证不替代运行时认证，也不授予操作者权限。本指南使用本地运行时；远程运行时不支持本地所有者凭证。

## 3. 创建后端 worktree

假设 `/work/frontend` 和 `/work/backend` 是已有提交的 Git 检出目录。创建功能分支及关联检出目录：

**你 / worktree 管理器**

```bash
git -C /work/backend worktree add -b feature/cross-project /work/backend-feature
```

查询任一检出目录前，使用维护示例提供的原生设置命令初始化各自的 CodeGraph 索引。如果第 1 步使用了 `--executable`，请将下方 `codegraph` 替换为同一个可执行文件的绝对路径：

**你——后端原生设置**

```bash
codegraph init /work/frontend --yes
codegraph init /work/backend-feature --yes
```

如果使用已授权的自动准备配方，可改为在查询前执行第 6 步。如果检出目录已有最新索引，按 CodeGraph 的更新指引操作即可。Setup 模板禁用了文件监听，源码变化后需要同步索引。使用其他后端时，请为每个检出目录完成其原生设置。

如果 `/work/backend-feature` 没有本地 `.1mcprc`，1MCP 可以继承 `/work/backend/.1mcprc`，但查询的仍然是**功能 worktree 的源码**。如果 `.1mcprc` 已被 Git 跟踪，新检出目录通常已有自己的副本，该副本优先。

如需定制 worktree，在 `/work/backend-feature/.1mcprc` 中放入完整配置。服务器筛选方式**二选一**。如果已有名为 `development` 的 preset：

```json
{ "preset": "development" }
```

或者，要选择已添加 `code` 标签的服务器，改用以下文件：

```json
{ "tags": ["code"] }
```

使用实际存在的 preset 或标签名称，不要在同一配置中同时设置 `preset` 和 `tags`。无需本地覆盖时可以不创建 `.1mcprc`。本地文件整体替换继承文件，缺失字段不会合并。本地文件无效时，1MCP 会记录警告并忽略其中设置，不会恢复继承配置。依赖其筛选条件或准备偏好之前，必须先修复该文件。继承规则见[项目 Checkout 与集合](/zh/guide/project-checkouts)。

## 4. 选择并查询各项目

### 选择 `--project` 还是 `--project-set`

| 任务                                               | 传入参数                                                                         | 含义                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| 在一个仓库或 worktree 中工作                       | `--project /work/backend-feature`                                                | 直接选择该检出目录，无需项目集合文件。     |
| 经常跨多个命名仓库工作                             | `--project-set /work/feature-projects.json --project backend`                    | 加载集合并选择 `backend` 成员。            |
| 给 worker 分配多个成员，或调用原生支持多项目的后端 | `--project-set /work/feature-projects.json --project frontend --project backend` | 按该顺序选择成员；单项目工具仍需分别调用。 |

只有一个检出目录时，直接传路径即可：

**AI 智能体**

```bash
1mcp inspect codegraph --project /work/backend-feature --project-owner "$SESSION_OWNER"
```

需要用固定名称简化跨仓库工作或 worker 分配时，再使用保存的集合。`--project-set` 指向**定义文件**，不是仓库；此时 `--project` 指定**成员标签**，不是路径。加载文件不会改变会话的全局工作目录，也不会调用所有项目。多成员集合在项目相关调用中需要明确标签或保存的 `selection`；命令行标签会覆盖保存的选择。

### 保存前后端项目集合

将以下完整 JSON 保存为 `/work/feature-projects.json`：

```json
{
  "name": "cross-project-feature",
  "projects": [
    { "label": "frontend", "path": "./frontend" },
    { "label": "backend", "path": "./backend-feature" }
  ]
}
```

相对路径从 JSON 文件所在目录解析。使用项目集合时，`--project` 选择**标签**；不使用集合时，它选择检出目录路径。此集合刻意不设默认选择，因此每次项目相关调用都必须指定目标。

如果钩子尚未提供当前分配目标的指令，先获取指令。调用工具前，检查已配置的服务器及工具 schema：

**AI 智能体**

```bash
# 仅在当前目标指引尚未交付时执行：
1mcp instructions --project-set /work/feature-projects.json --project frontend --project-owner "$SESSION_OWNER"
1mcp inspect codegraph --project-set /work/feature-projects.json --project frontend --project-owner "$SESSION_OWNER"
1mcp inspect codegraph/codegraph_explore --project-set /work/feature-projects.json --project frontend --project-owner "$SESSION_OWNER"
1mcp run codegraph/codegraph_explore --project-set /work/feature-projects.json --project frontend --project-owner "$SESSION_OWNER" --args '{"query":"Where does the frontend call the backend API?"}'
```

对后端 worktree 重复此流程：

**AI 智能体**

```bash
# 仅在当前目标指引尚未交付时执行：
1mcp instructions --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
1mcp inspect codegraph --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
1mcp inspect codegraph/codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
1mcp run codegraph/codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER" --args '{"query":"Where are the backend API routes defined?"}'
```

示例要求 CodeGraph 提供带 `query` 参数的 `codegraph_explore`。以实际安装服务器返回的 schema 为准。确认结果来自所选检出目录，且索引覆盖当前源码。服务器已连接或主检出目录已有索引，并不能证明 worktree 已就绪。

选择 `--project frontend --project backend` 不会广播调用，也不会改变全局当前项目。单项目工具需要分别调用，如上所示。只有原生支持项目集合的后端才能在一次调用中接收两个目标。动态模板在检查时也要保留项目选择参数；静态且与项目无关的服务器及 schema 检查不需要检出目录选择参数。

## 5. 为每个 worker 独立分配目标

由你或负责协调的 AI 智能体在派发提示词中给出明确分配。以下 bootstrap 命令由 **worker AI 智能体**执行：

> 你的 Worker Project Assignment 是 `/work/feature-projects.json` 中的 `backend` 标签（检出目录 `/work/backend-feature`）。只处理本功能的后端部分。使用你自己的 bootstrap 凭证。在项目相关发现之前，执行 `1mcp bootstrap --client codex --event SubagentStart --project-set /work/feature-projects.json --project backend --project-owner YOUR_OWN_CREDENTIAL_PATH`。后续调用保留该选择和你的凭证。运行工具前先检查服务器及工具 schema。任务完成时释放你自己的 backend 绑定。

前端 worker 使用 `frontend` 标签和 `/work/frontend` 检出目录。如果直接分配路径，将 `--project-set ... --project backend` 替换为 `--project /work/backend-feature`。Claude Code 使用 `--client claude`。

Worker 将 `YOUR_OWN_CREDENTIAL_PATH` 替换为自己经验证的启动钩子提供的凭证路径。显式 bootstrap 调用解析任务目标；父会话的 cwd 或会话身份不代表目标分配。如果启动时已经收到正确分配和指令，无需重复获取。

每个 worker 将 `SESSION_OWNER` 设为自己的凭证，并针对所选目标执行第 4 步。不要将父 shell 的值传给子 worker。并发 worker 可以选择不同检出目录，而不改变彼此的目标。

## 6. 按需准备后端

如果已完成原生设置，且没有配置准备配方，可以跳过此步骤。**1MCP 不内置 CodeGraph、Code Review Graph 或 Serena 的自动准备配方。** 如果团队提供配方，请按[后端准备指南](/zh/guide/backend-preparation)配置，包括支持的操作与权限。

### 检查、准备并重新调用工具

以下示例假设配方配置在 `codegraph` 上，并覆盖 `codegraph_explore`。如果配方使用其他后端或操作名称，请相应替换：

**AI 智能体**

```bash
1mcp project prepare inspect codegraph --operation codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
1mcp project prepare start codegraph --operation codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER"
```

检查不会启动准备。仅在确实需要准备时启动已获许可的操作。如果返回任务 ID，将下方 `JOB_ID` 替换为实际 ID：

**AI 智能体**

```bash
1mcp project prepare wait codegraph JOB_ID --operation codegraph_explore --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER" --wait-ms 5000
```

排队或运行期间可重复有限等待。保持运行时、筛选条件、目标、所有者和操作一致。命令结束并不足够，必须确认就绪验证成功。失败时读取原因，解决问题后再明确重试。就绪后，重新检查服务器和 schema，再提交第 4 步中的**新工具调用**。准备过程不会自动重放原请求。

## 7. 释放并移除 worktree

Worker 完成分配的任务后，释放自己所选的绑定：

**AI 智能体——各调用方释放自己的绑定**

```bash
1mcp project release --project-set /work/feature-projects.json --project backend --project-owner "$SESSION_OWNER" --format json
```

前端 worker 使用 `--project frontend`。父会话也需要使用自己的凭证释放它曾使用的各目标：

**AI 智能体——各调用方释放自己的绑定**

```bash
1mcp project release --project-set /work/feature-projects.json --project frontend --project backend --project-owner "$SESSION_OWNER" --format json
```

Release 会保护其他所有者。非零退出可能表示清理仍未完成，应检查返回的阻塞项。`SessionEnd` 提供有限时间的会话清理，但 `Stop` 和 `SubagentStop` 不是终止事件。Worker 应在任务结束时显式释放，而非每次回复之后释放。

移除 `/work/backend-feature` 前，由获授权的本地操作者在**同一运行时**关闭新工作准入：

**本地操作者 / worktree 管理器**

```bash
1mcp project drain --project /work/backend-feature --project-owner "$SESSION_OWNER" --wait-ms 5000 --format json
1mcp project status --project /work/backend-feature --project-owner "$SESSION_OWNER" --format json
```

必须确认 drain 成功退出，且该检出目录的结果为 `complete: true`。Status 即使仍有阻塞项也可能退出为零。Drain 允许已准入工作完成，不会自动取消任务。其他所有者、订阅、共享后端或未解决的准备恢复记录都可能阻止清理。解决报告的阻塞项后重试 drain。Windows 上，如果无法验证正常退出，运行中的 stdio 后端可能持续阻塞清理。

运行时清理完成后，检查是否仍有其他运行时或无关进程占用目录，并保存工作，然后使用普通 Git 命令移除：

**本地操作者 / worktree 管理器**

```bash
git -C /work/backend worktree remove /work/backend-feature
```

不要强制移除以绕过未保存文件或生命周期阻塞。1MCP 不会删除目录、索引或配置，完成结果仅适用于选定运行时。移除后，从项目集合文件删除失效的 `backend` 成员，或在复用集合前将它更新为现有检出目录。

如果放弃移除，请显式恢复准入：

**本地操作者 / worktree 管理器**

```bash
1mcp project resume --project /work/backend-feature --project-owner "$SESSION_OWNER" --format json
```

超时会保留 draining 状态。该状态跨运行时重启及同一路径的删除重建持续存在，复用前必须执行 `resume`；它不会启动或准备后端。详细结果和阻塞项见[项目生命周期](/zh/commands/project/)。

## 故障排查

| 现象                     | 下一步                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| 目标选择未解析           | 每次项目相关调用选择集合中的标签，并为每个 worker 明确分配目标。                                          |
| 结果来自错误的检出目录   | 检查集合解析后的路径、本地 `.1mcprc`、模板与固定目录配置，以及原生索引的新鲜度。                          |
| 没有操作指引或所有者凭证 | 确认实际客户端已启用、信任并执行钩子；项目相关调用前先解决 bootstrap 错误。                               |
| 准备不可用或被阻止       | 检查是否有配方、是否支持该操作和平台、是否允许执行；否则完成原生设置。                                    |
| 清理始终未完成           | 读取 `blockers`，让每个所有者释放绑定，等待已准入工作完成。移除前必须确认 drain 成功且 `complete: true`。 |
| 检出目录仍在 draining    | 放弃移除时由操作者显式执行 `project resume`；重启运行时不会重新开放准入。                                 |
