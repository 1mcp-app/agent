---
title: 管理工具
description: 通过已启用的内部管理工具检查和修改后端状态。
---

# 管理工具

这些 MCP 工具在启用后操作后端状态和配置。访问要求见[内部工具](/zh/reference/internal-tools/)。调用前检查暴露的输入 Schema；MCP 工具名称与选项不是 CLI 子命令。

## mcp_enable 和 mcp_disable

两者都要求 `name`。启用或禁用会修改配置目标的状态，不验证依赖图，也不证明所有后端前置条件已经满足。请读取返回的状态、警告及重载建议，再验证运行时状态。禁用独立托管的远程后端不会关闭该远程服务。

## mcp_list

列出已配置服务器。输入包括 `status`、`transport`、`tags`、`format`、`detailed`、`includeCapabilities`、`includeHealth` 和 `sortBy`。返回状态是一项观测，不保证之后的工具调用成功。

## mcp_status

省略 `name` 查询所有目标，或提供一个目标名称。`details` 默认为 `false`，启用后可查看实例与监督详情。`health` 默认为 `true`。

结果是当前快照，不提供历史状态跟踪或趋势分析。

## mcp_reload

请求配置重载或指定后端重启。`configOnly` 默认为 `true`；`timeout` 单位为毫秒，默认 `30000`。检查 `status`、`error` 和可能返回的结构化 `outcome`，包括实例不明确或目标已禁用等结果。

重载不保证零停机或自动回滚，并可能影响已连接任务。`mcp_reload` 是 MCP 工具，没有对应的 `1mcp mcp reload` CLI 子命令。受支持的 CLI 重启流程见 [mcp restart](/zh/commands/mcp/restart)。

## mcp_edit

编辑由 `name` 指定的一个目标。支持字段包括启动参数、环境变量、URL、请求头、标签、超时和监督设置。`env` 和 `tags` 替换现有值，而不是追加。

使用 `preview: true` 在应用前检查变更。`backup` 控制备份创建；请检查返回的 `backupPath`、警告和 `reloadRecommended`。编辑成功不代表后端就绪。此 API 不提供语法高亮编辑器或批量编辑接口。

## 验证变更

检查目标当前状态，在支持时预览编辑内容，仅应用已授权变更，然后再次检查结果和运行时状态。失败或结果不明确时，应先确认变更是否已生效，不要直接重复修改。
