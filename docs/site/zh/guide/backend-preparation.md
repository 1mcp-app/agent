---
title: 后端准备
description: 了解服务器何时需要准备、如何启用已有配方，以及如何查看准备进度。
---

# 后端准备

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

在 `mcp.json` 的 `mcpServers` 或 `mcpTemplates` 中，找到已有的服务器条目并添加 `preparation`。以下示例仅展示配置结构：**`team-source-search` 和文件路径都是占位示例，不是内置配方**。请替换为配方提供的 ID 和绝对路径。

```json
{
  "preparation": {
    "adapter": "configured-command",
    "definition": {
      "id": "team-source-search",
      "file": "/absolute/path/to/source-search.json"
    },
    "activation": "setup",
    "allowedActions": ["initialize", "sync"]
  }
}
```

| 设置                  | 填写内容                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| `definition.id`       | 配方中声明的 ID。                                                             |
| `definition.file`     | 本机配方文件的绝对路径。                                                      |
| `definition.inputs`   | 仅当配方需要本机输入时添加此对象，使用配方说明中的输入名称。                  |
| `activation: "setup"` | 为使用此服务器的已授权项目启用自动准备，无需逐个项目启用。                    |
| `allowedActions`      | 你允许执行的操作。仅当配方支持且你希望执行时，才加入 `initialize` 和 `sync`。 |

可以与队友共享配方及随附文件。每个人在自己的 `mcp.json` 中填写本机路径和输入。更新配方不会授予额外操作权限。已有的内联准备配置仍然有效，无需转换。

若要关闭某个项目的自动准备，在其生效的 `.1mcprc` 中添加以下配置，将 `source-search` 替换为 `mcp.json` 中的**服务器配置名称**：

```json
{ "preparation": { "source-search": { "enabled": false } } }
```

项目的显式禁用优先于 `activation: "setup"`。若要禁用整个服务器的准备功能，在 `mcp.json` 中该服务器的 `preparation` 内设置 `enabled: false`。

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

项目选择和设置继承规则见[项目副本与项目集](/zh/guide/project-checkouts)。如果你要开发配方，请参阅单独的[集成作者指南](https://github.com/1mcp-app/agent/blob/main/docs/development/backend-preparation-recipes.md)。
