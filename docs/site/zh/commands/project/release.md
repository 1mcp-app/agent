---
title: 释放调用方的 Project 绑定
description: 释放当前会话或工作代理的绑定，保护其他所有者。
---

# project release

仅释放已验证调用方在选定检出目录中的绑定。其他会话、兄弟工作代理、活动请求、订阅和共享后端仍受保护。

## 用法

```bash
1mcp project release --format json
```

受支持的 Codex 会话自动定位自己的已有凭证和启动分配项目。Claude 或既无可信线程定位记录、也无双标识接入的宿主需通过 `--project-owner <own-file>` 保留 bootstrap 凭证路径。工作代理使用自己的凭证。相同目录路径或声称的会话 ID 不足以证明所有权。

默认使用会话分配，可通过 `--project` 单次覆盖目录，或显式选择 `--project-set` 中的成员。清理期间保持相同的运行时 `--context` 或 `--url`。

## 结果与后续操作

退出码为零表示所有选定目录的清理结果均已完成。非零退出码可能表示其他所有者、已准入任务、订阅或后端进程仍在阻塞清理。检查 `results[].complete`、`results[].ownerReleased` 和 `results[].blockers`，等待剩余工作结束，必要时再次释放。

释放不会关闭准入或删除目录。移除目录时，应遵循[管理器移除流程](/zh/commands/project/#管理器移除流程)，并由操作员[排空目录](/zh/commands/project/drain)。

自动结束清理的覆盖范围与限制见[会话与工作代理钩子](/zh/commands/project/#会话与工作代理钩子)。

`ownerReleased: true` 证明当前所有者已安全释放，不代表目录无人使用。手动释放保留凭证供后续调用；已验证的根会话 SessionEnd 仅在安全释放得到证明后删除私有状态。终止清理失败时可用 `1mcp project recover --project-owner <ended-own-file>` 重试记录目标。恢复要求终止证据，不能根据年龄、Stop 或父任务消失推断终止。
