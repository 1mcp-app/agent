---
title: 内部安装工具
description: 内部 MCP 安装工具的输入和输出查询参考。
---

# 安装工具

这些工具会修改 MCP 服务器配置。调用前请通过 `tools/list` 查询其精确 schema。

## mcp_install

必填输入：

- `name`：本地 MCP 服务器配置名称。

可选输入：

- `version`、`package`、`command`、`args`、`url`、`transport`（`stdio`、`sse` 或 `http`）、`tags`、`env`。
- `force`（默认 `false`）、`backup`（默认 `true`）、`enabled`（默认 `true`）、`autoRestart`（默认 `false`）。
- 已知时使用 `registryId`、`installationMethod`（`package` 或 `remote`）和 `prerequisites`。

直接安装 stdio 包时，使用 `name`、`package`、`command` 和 `args`：

```json
{
  "name": "project-dependencies",
  "package": "@scope/project-mcp",
  "command": "npx",
  "args": ["-y", "@scope/project-mcp"]
}
```

结果包含 `name`、`status` 和 `message`，也可能包含 `package`、`version`、`configPath`、`backupPath`、`warnings`、`reloadRecommended` 和 `error`。

## mcp_uninstall

必填输入为 `name`。可选布尔值：`preserveConfig`（默认 `false`）、`force`（默认 `false`）、`graceful`（默认 `true`）、`backup`（默认 `true`）和 `removeAll`（默认 `false`）。

## mcp_update

必填输入为 `name`。可选输入为 `version`、`package`、`autoRestart`（默认 `true`）、`backup`（默认 `true`）、`force`（默认 `false`）和 `dryRun`（默认 `false`）。

另请参阅[内部工具](/zh/reference/internal-tools/)和 [MCP CLI 命令](/zh/commands/mcp/)。
