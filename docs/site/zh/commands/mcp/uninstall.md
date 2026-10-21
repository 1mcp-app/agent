---
title: mcp uninstall
description: 从配置中移除后端，并可选择创建配置备份。
---

# mcp uninstall

从所选配置中移除静态服务器或模板定义。此命令修改配置，不删除后端软件包、仓库或数据。

## 语法

```bash
1mcp mcp uninstall <server-name> [--force] [--no-backup]
```

`<server-name>` 是已有配置目标的名称，不是注册表 ID。

## 选项

| 选项                      | 默认值       | 行为                                               |
| ------------------------- | ------------ | -------------------------------------------------- |
| `--config, -c <path>`     | 所选配置     | 指定配置文件                                       |
| `--config-dir, -d <path>` | 默认配置目录 | 指定配置目录                                       |
| `--backup`                | `true`       | 移除前必须成功创建配置备份；`--no-backup` 跳过备份 |
| `--remove-config`         | `true`       | 移除定义；`--no-remove-config` 保留定义            |
| `--force`                 | `false`      | 覆盖当前进程内的使用中检查                         |
| `--verbose, -v`           | `false`      | 启用详细日志                                       |

处理程序不会请求交互确认。执行前请核对目标和所选配置。使用中检查既不是依赖图检查，也不能完整反映其他运行时中的活动。

## 移除并验证

```bash
1mcp mcp list
1mcp mcp uninstall filesystem
1mcp mcp list
```

成功后，命令会报告已创建的备份路径、重载状态和警告。配置写入成功不代表运行时已经应用移除。请检查重载结果，并通过目标运行时的 `1mcp inspect` 确认后端已不再出现。

如果提示目标正在使用，请在使用 `--force` 前检查活动任务。独立托管的远程服务会继续运行；此命令仅移除其 1MCP 配置。

## 恢复备份

使用命令实际报告的备份路径。恢复所选配置文件前先检查备份内容：整文件恢复也会撤销备份之后的其他配置变更。随后重新验证配置重载和发现结果。

`--no-remove-config` 不会卸载软件包，也不是“保留数据但移除配置”。它跳过移除并输出警告。

## 相关命令

- [mcp install](/zh/commands/mcp/install) — 配置注册表服务器
- [mcp enable / disable](/zh/commands/mcp/enable-disable) — 保留定义并禁用服务器
- [mcp remove](/zh/commands/mcp/remove) — 移除配置目标
- [服务器管理](/zh/guide/essentials/server-management)
