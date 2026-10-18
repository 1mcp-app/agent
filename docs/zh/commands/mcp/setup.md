---
title: mcp setup
description: 使用维护的示例配置已安装的 CodeGraph、Code Review Graph 或 Serena 后端。
---

# mcp setup

无需手写 JSON 即可配置已安装的后端。此命令支持 CodeGraph、Code Review Graph 和 Serena。浏览及安装注册表服务器请使用 [mcp install](/zh/commands/mcp/install)。

setup 是生成服务器配置的便捷入口。若要定制或共享自动准备，请在 `mcp.json` 中通过 `preparation.definition` 配置[引用式配方](/zh/guide/backend-preparation)。即使使用 `--force`，setup 也会保留已有自定义配方、输入、启用选择、禁用设置及权限。三个维护的示例不提供已验证的原生准备配方。

## 命令语法

交互式选择维护的示例：

```bash
1mcp mcp setup
```

直接选择示例：

```bash
1mcp mcp setup --known codegraph
1mcp mcp setup --known code-review-graph
1mcp mcp setup --known serena
```

## 选项

| 选项                         | 行为                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `--interactive, -i`          | 直接指定示例时提示补全前置条件并确认配置。                            |
| `--known <id>`               | 选择 `codegraph`、`code-review-graph` 或 `serena`；省略时交互式选择。 |
| `--executable <path>`        | 使用指定路径的已安装可执行文件，不从 PATH 查找。                      |
| `--checkout <absolute-path>` | 配置静态副本目标；省略时创建可复用的副本绑定模板。                    |
| `--name <name>`              | 设置本地配置名称，默认为示例 ID。                                     |
| `--dry-run`                  | 验证并预览，不保存配置或启动后端。                                    |
| `--force`                    | 显式重新配置已有示例，保留无关设置和覆盖项；等价配置本身就是无操作。  |

命令也接受 `--config`、`--config-dir` 等全局配置选择选项。

## 示例

指定可执行文件并预览可复用模板：

```bash
1mcp mcp setup --known codegraph --executable /absolute/bin/codegraph --dry-run
```

预览固定副本目标：

```bash
1mcp mcp setup --known serena --checkout /absolute/project --name project-serena --dry-run
```

移除 `--dry-run` 后保存。默认模板使用项目上下文工作流选择并授权的副本，不绑定 setup 命令的工作目录。之后可用 `1mcp inspect serena --project /absolute/project` 选择副本。

## 结果与限制

配置成功时，输出分别报告配置变更、重载观察及原生就绪状态。等价重复配置不会更改配置。有实际变化的重新配置需要 `--force`；静态服务器和模板名称冲突时会失败，不会静默迁移目标。已有覆盖项、密钥引用、禁用设置和准备权限限制会保留。

请先安装后端可执行文件及语言依赖。缺少前置条件时会提供指引；setup 不下载依赖、不初始化索引、不完成 onboarding，也不授予副本访问权限。它不启用自动准备，也不证明源码新鲜度。运行时已启动时，保存静态后端可能通过普通配置重载启动它；原生启动仍保留自身行为。

## 已测版本

配置示例在 macOS 26.6.2 arm64、Node.js 26.4.0、CodeGraph 1.6.2、Code Review Graph 2.3.9 和 Serena 2.0.0（individual-tools 接口）上验证。Serena 的 TypeScript 示例使用 TypeScript 5.9.3 和 typescript-language-server 5.1.3。其他版本、平台、语言和大型仓库不在已测范围内。这些配置检查不证明自动准备支持。

## 另请参阅

- [后端准备](/zh/guide/backend-preparation) — 当前支持范围、已有配方和准备进度。
- [项目副本](/zh/guide/project-checkouts) — 目标选择与授权。
- [mcp install](/zh/commands/mcp/install) — 注册表安装。
