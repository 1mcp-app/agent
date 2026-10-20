---
title: 释放调用方的 Project 绑定
description: 释放当前会话或工作代理的绑定，保护其他所有者。
---

# project release

仅释放已验证调用方在选定检出目录中的绑定。其他会话、兄弟工作代理、活动请求、订阅和共享后端仍受保护。

## 用法

```bash
1mcp project release --project /work/frontend --project-owner /private/session-owner.json --format json
```

将示例所有者文件替换为当前会话 bootstrap 提供的私有凭证路径，并在后续调用中保留。工作代理应使用自己的凭证。相同目录路径或声称的会话 ID 不足以证明所有权。

通过 `--project` 选择目录，或显式选择 `--project-set` 中的成员。清理期间保持相同的运行时 `--context` 或 `--url`。

## 结果与后续操作

退出码为零表示所有选定目录的清理结果均已完成。非零退出码可能表示其他所有者、已准入任务、订阅或后端进程仍在阻塞清理。检查 `results[].complete` 和 `results[].blockers`，等待剩余工作结束，必要时再次释放。

释放不会关闭准入或删除目录。移除目录时，应遵循[管理器移除流程](/zh/commands/project/#管理器移除流程)，并由操作员[排空目录](/zh/commands/project/drain)。

自动结束清理的覆盖范围与限制见[会话与工作代理钩子](/zh/commands/project/#会话与工作代理钩子)。
