---
title: 后端准备
description: 了解服务器何时需要准备、如何启用已有配方，以及如何查看准备进度。
---

# 后端准备

从设置到清理的完整流程，参见[跨项目与 Git Worktree 工作指南](/zh/guide/worktrees-and-cross-project-sessions)。

下方示例使用已验证启动钩子的受支持 Codex 会话：1MCP 自动解析所有者和已分配项目。Claude 或不支持自动查找所有者的宿主需添加 `--project-owner <own-file>`，使用该调用方自己的 bootstrap 凭证；worker 也使用自己的凭证。示例中的显式项目参数用于覆盖目标、选择其他检出目录。设置与回退方式见 [CLI setup](/zh/commands/cli-setup)。

命令语法、选项、适用人群和恢复示例请参阅 [Prepare 命令参考](/zh/commands/project/prepare)。

有些 MCP 服务器需要先初始化项目或更新索引，才能处理请求。**准备功能**让 1MCP 执行这些步骤，并检查服务器是否已准备好处理你选定的项目。

只有在你已有适用于服务器的配方时，才需要配置准备功能。**配方**是一个 JSON 文件，告诉 1MCP 如何检查就绪状态，以及运行哪些准备命令。它可以由你的团队或集成维护者提供。

## 目前支持什么？

**1MCP 目前没有内置 CodeGraph、Code Review Graph 或 Serena 的自动准备配方。** `mcp setup` 配置这些服务器的启动方式；它们各自的原生项目设置仍需单独完成。

| 服务器            | 配置完成后需要做什么                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| CodeGraph         | 使用 CodeGraph 初始化选定项目，并在源文件变化后同步。setup 示例禁用了文件监听器。 |
| Code Review Graph | 使用 Code Review Graph 构建项目图，并按需更新。                                   |
| Serena            | 安装项目所需的语言服务器依赖，按照 Serena 的指引完成项目设置和 onboarding。       |

配置其中一个服务器时，请参阅 [mcp setup](/zh/commands/mcp/setup)。使用它们不需要自己编写准备配方。配置完成后，通过 `--project` 选择已授权项目；同一个服务器模板可以用于多个项目，但每个项目仍可能需要原生初始化。

## 借助技能配置准备流程

运行 `1mcp cli-setup --codex` 或 `1mcp cli-setup --claude`，即可随常规引导文件安装 `1mcp-preparation-setup` 技能。仅为仓库安装时，添加 `--scope repo --repo-root /path/to/repo`。[CLI setup 参考](/zh/commands/cli-setup#准备配置技能)列出了安装路径、更新与冲突处理方式。

请智能体使用此技能为指定后端和检出目录配置准备流程。它会检查已安装版本及现有权限，复用或编写配方，并验证配方声明的就绪范围和一次新的工具调用。实验性配方需要用户接受具体限制；配置探针成功不代表索引或语言服务器已经就绪。

安装技能不会启用准备。技能提供操作指引，并未附带上述三个后端的生产配方。也可以继续按下方说明手动配置已有配方。

## 使用为服务器提供的配方

如果团队或集成维护者提供了配方，请将它和随附的辅助文件保存在本机。按照配方说明确认后端版本、依赖、必需输入和允许执行的操作。自动准备目前支持 Linux 和 macOS。

复制配置前，先选择生效范围：

- **使用此后端的所有已授权项目：** 保留下方的 `activation: "setup"`，个别项目可以禁用准备。
- **仅指定项目：** 省略 `activation`，再按下方示例在各检出目录的 `.1mcprc` 中启用准备。

在 `mcpServers` 或 `mcpTemplates` 下的现有后端条目中添加准备配置。下方以 CodeGraph 模板及团队提供的配方为例，并非内置集成。

打开运行时及 `mcp setup` 使用的同一个 `mcp.json`。在**现有 `mcpTemplates.codegraph` 条目内部**添加 `preparation`，与 `command`、`args`、`cwd` 同级。以下完整示例展示其位置。请保留已有的可执行文件路径、环境变量、模板选项和其他服务器，不要用示例覆盖整个文件。

::: v-pre

```json
{
  "mcpServers": {},
  "mcpTemplates": {
    "codegraph": {
      "command": "/absolute/path/to/codegraph",
      "args": ["serve", "--mcp", "--path", "{{{project.path}}}", "--no-watch"],
      "cwd": "{{{project.path}}}",
      "env": {
        "CODEGRAPH_NO_DOWNLOAD": "1",
        "CODEGRAPH_NO_DAEMON": "1"
      },
      "template": { "shareable": true, "perClient": false },
      "preparation": {
        "adapter": "configured-command",
        "definition": {
          "id": "team-codegraph",
          "file": "/absolute/path/to/recipes/codegraph.json"
        },
        "activation": "setup",
        "allowedActions": ["initialize", "sync"]
      }
    }
  }
}
```

:::

将 `/absolute/path/to/codegraph` 替换为已安装的可执行文件路径。将 `team-codegraph` 替换为配方声明的 ID，将 `definition.file` 替换为配方的本地绝对路径。这些是占位值，不是内置的 CodeGraph 集成。如果配方声明了本机输入参数，按其文档中的名称和值添加 `definition.inputs`。

| 设置                                 | 作用                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `adapter: "configured-command"`      | 运行配方的就绪探测和已获许可的命令。                                        |
| `definition.id` 和 `definition.file` | 根据声明的 ID 和绝对文件路径选择配方；辅助文件保持作者提供的目录布局。      |
| `activation: "setup"`                | 对使用此后端的已授权检出目录启用自动准备，无需逐项目添加启用设置。          |
| `allowedActions`                     | 限定允许运行的配方操作。仅在配方支持且你允许时添加 `initialize` 和 `sync`。 |

保存配置后检查下一次就绪查询。重载成功不代表索引已就绪。配方和 activation 都不会授予额外检出目录访问权，也不会授予安装依赖、全量重建或使用付费服务的权限。

共享配方及辅助文件时，保留作者提供的目录布局。每个人在自己的 `mcp.json` 中填写本地路径和输入。现有内联准备配置仍受支持。

### 选择哪些项目启用准备

**你——项目偏好。**

如果只想在指定项目中自动准备，**从服务器条目中省略 `activation: "setup"`**，然后在所选检出目录的 `.1mcprc` 中启用：

```json
{
  "preparation": {
    "codegraph": { "enabled": true }
  }
}
```

如果已经设置全局启用，则可以对某个检出目录禁用：

```json
{
  "preparation": {
    "codegraph": { "enabled": false }
  }
}
```

键 `codegraph` 是配置中的服务器名称，不是配方 ID。将此偏好添加到检出目录的完整有效配置中，保留所选的 preset **或** tags。Worktree 本地 `.1mcprc` 会整体替换继承设置，见[项目 Checkout](/zh/guide/project-checkouts)。无效的本地文件会被忽略，且不会恢复继承设置；依赖准备偏好之前，必须先修复文件。项目启用设置不会增加已许可操作；明确的项目禁用优先于 setup 级启用。要在所有项目中禁用该后端的准备，在 `mcp.json` 中该后端的 `preparation` 内设置 `enabled: false`。

## 工具需要准备时

照常调用工具。如果需要准备，1MCP 会返回任务 ID，而不会执行工具。等待任务就绪后，**重新调用工具**。原来的请求不会自动重放。

如果准备失败，或检查无法确认就绪，受影响的工具会继续被阻止。不需要准备的其他工具仍然可用。

你也可以自行检查或启动准备。下面的例子中，将 `source-search` 替换为服务器配置名称，`lookup` 替换为配方覆盖的工具名称，`/work/project` 替换为已授权的项目路径：

```bash
1mcp project prepare inspect source-search --project /work/project --operation lookup
1mcp project prepare source-search --project /work/project --operation lookup
```

`inspect` 只检查就绪状态，不启动准备。`prepare` 在需要时启动已允许的操作，即使服务器尚未列出任何工具，也可以使用。

使用返回的任务 ID 查看进度：

```bash
1mcp project prepare wait source-search JOB_ID --project /work/project --wait-ms 5000
```

如果任务仍在运行，请再次等待。你也可以使用 `prepare status`、`prepare cancel` 或 `prepare retry`，传入相同的服务器名称、任务 ID 和项目。

## 准备无法完成时

| 结果                   | 应对方式                                 |
| ---------------------- | ---------------------------------------- |
| 已就绪                 | 重新提交工具请求。                       |
| 排队中或运行中         | 等待任务，并查看结果。                   |
| 已禁用或操作未授权     | 检查服务器准备权限和项目设置。           |
| 冲突                   | 等待另一个后端操作完成，然后重新检查。   |
| 未知或不支持           | 按配方指引处理，或使用后端原生设置流程。 |
| 失败、已取消或尚未就绪 | 阅读原因，解决问题后按需显式重试。       |

准备命令结束不一定意味着服务器已就绪：1MCP 会再次检查，确认后才允许工具运行。每个任务只执行一个操作，因此结果可能提示你重试以完成下一步。

配方可以显式报告后端版本不受支持或探测结果不确定，并提供由操作人员编写的说明。这些结果会继续阻止工具执行，也不会启动准备操作。解决说明中的前置问题后再检查；不能把未知状态视为已就绪。说明来自配置的配方，不直接采用后端原始输出。

项目选择和设置继承规则见[项目副本与项目集](/zh/guide/project-checkouts)。如果你要开发配方，请参阅单独的[集成作者指南](https://github.com/1mcp-app/agent/blob/main/docs/development/backend-preparation-recipes.md)。
