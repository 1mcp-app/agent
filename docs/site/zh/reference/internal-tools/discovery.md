---
title: 发现工具
description: 注册表查询工具及返回元数据的限制。
---

# 发现工具

启用相应内部工具后，运行时会暴露这些工具。调用与访问要求见[内部工具概览](/zh/reference/internal-tools/)。

## mcp_search

使用 `query`、`status`（默认 `active`）、`type`、`transport`、`limit`（默认 `20`）和 `cursor` 搜索注册表元数据。结果包含安装提示和前置条件标记。

输入 Schema 还接受 `tags`、`category`、`offset` 和 `format`，但当前处理程序不应用这些字段。它不提供按热度排序或本地模糊搜索保证。`total` 是本次返回的条目数，不是整个注册表的大小。`installable` 提示仅表示元数据包含软件包或远程端点，不证明安装、凭据或启动会成功。

## mcp_registry_status

通过已配置的注册表适配器检查连通性。`includeStats` 默认为 `false`。响应可包含响应时间和检查时间戳，不是历史可用性序列。`registry` 输入用于标记结果，不会将适配器切换到任意 URL。

## mcp_registry_info 和 mcp_registry_list

这些处理程序目前返回静态占位注册表描述和计数。不要将条目、在线标签或包数量视为实时发现、已验证端点或可用性证据。受支持的注册表工作流见[注册表命令](/zh/commands/registry/)。

## mcp_info

通过必需的 `name` 和可选的 `version` 查询注册表条目，不检查运行中的后端。当前响应使用占位的运行状态、传输类型和生成的能力名称，不能将其作为可调用工具清单。Schema 接受 `includeCapabilities`、`includeConfig` 和 `format`，但当前处理程序不会根据这些字段调整结果。

实际可见能力请使用 [inspect](/zh/commands/inspect)，运行时状态请使用 [mcp status](/zh/commands/mcp/status)。

## 建议工作流

搜索条目、检查前置条件，并用 [mcp install](/zh/commands/mcp/install) 验证目标。完成配置后，对目标运行时验证发现结果。注册表元数据本身不能证明运行时就绪或后端可信。
