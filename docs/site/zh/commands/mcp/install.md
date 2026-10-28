---
title: mcp install
description: 根据注册表条目生成后端配置。
---

# mcp install

查询注册表条目并向 `mcp.json` 写入后端定义。这里的安装是配置启动命令或远程端点。软件包可能在后端启动时才下载；此命令本身不验证软件包完整性，也不解析依赖图。

## 语法

```bash
1mcp mcp install
1mcp mcp install <registry-id> [--dry-run] [--force]
1mcp mcp install <registry-id>@<version>
```

不提供 ID 或使用 `--interactive` 时，命令会打开安装向导。请使用 [registry search](/zh/commands/registry/search) 返回的 ID；示例名称并不保证所选注册表中存在该条目。

## 选项

| 选项                      | 行为                                         |
| ------------------------- | -------------------------------------------- |
| `--interactive, -i`       | 打开安装向导                                 |
| `--dry-run`               | 验证目标，不写入；输出名称、版本和注册表来源 |
| `--force`                 | 替换已有静态服务器配置；不能替换模板         |
| `--verbose, -v`           | 启用详细日志                                 |
| `--config, -c <path>`     | 指定配置文件                                 |
| `--config-dir, -d <path>` | 指定配置目录                                 |

注册表连接选项见[注册表命令](/zh/commands/registry/)。

## 发现、预览、应用

```bash
1mcp registry search filesystem
1mcp mcp install <registry-id> --dry-run
1mcp mcp install <registry-id>
1mcp mcp list
```

执行安装命令前，将 `<registry-id>` 替换为实际搜索结果。配置中的本地名称由注册表 ID 派生。使用 `--dry-run` 时，输出包含目标名称、版本和注册表来源，不显示生成的可执行文件、参数或 URL。使用 `1mcp registry show <registry-id> --format json` 检查注册表元数据。如果需要在写入前检查准确的启动配置，请改用 [mcp add](/zh/commands/mcp/add) 提供明确的命令或 URL。安装后，检查所选 `mcp.json` 中保存的条目。

当条目包含软件包时，解析器优先选择 npm 包；否则选择远程端点，并优先使用 Streamable HTTP。不支持的软件包类型会报错，不会改用其他包管理器安装。

`@<version>` 选择注册表元数据，本身不会将生成的 npm 包参数固定为该版本。请检查注册表元数据；需要固定软件包版本时，使用 [mcp add](/zh/commands/mcp/add) 配置明确带版本的包。

## 验证就绪状态

检查命令报告的配置和重载结果，然后对目标运行时执行 `1mcp inspect`。定义已保存不代表后端已经启动或完成认证。请按后端的配置文档及[配置参考](/zh/reference/mcp-servers) 补充必要的凭据和服务器参数。

`mcp update` 修改配置，不是注册表软件包升级命令。替换注册表生成的定义前，先验证目标条目并检查其注册表元数据，再使用 `--force`。

## 相关命令

- [mcp setup](/zh/commands/mcp/setup) — 配置已安装的受支持后端
- [mcp add](/zh/commands/mcp/add) — 提供明确的启动命令或 URL
- [mcp uninstall](/zh/commands/mcp/uninstall) — 移除定义
- [服务器管理](/zh/guide/essentials/server-management)
