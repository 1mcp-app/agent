---
title: 排空 Project 检出目录
description: 关闭准入，并等待选定运行时完成可验证的目录清理。
---

# project drain

要求本地操作员权限，关闭单个目录的准入，并报告选定运行时是否已释放该目录。已有所有者不能开始新工作；已准入的任务可以正常结束。

## 用法

```bash
1mcp project drain --project /work/frontend --wait-ms 5000 --format json
```

必须选择恰好一个目录。移除期间保持相同的 `--context` 或 `--url`。`--wait-ms` 接受 0–60000 毫秒；省略时立即返回当前状态。超时后准入保持关闭。

## 完成条件与阻塞项

同时要求退出码为零且 `results[0].complete: true`，才能判定排空完成。等待中、阻塞、超时和错误均返回非零。通过 [project status](/zh/commands/project/status) 查看剩余阻塞项。

排空不会取消任务或终止活动工作。每个所有者需要[释放自己的绑定](/zh/commands/project/release)。准备任务必须完成，或通过已授权的[准备控制](/zh/commands/project/prepare)显式取消。订阅和共享资源可能阻止完成。

Windows 上无法验证优雅终止时，存活的 stdio 后端仍是阻塞项，清理不会改用强制终止。通过受支持且显式授权的操作员流程停止这些后端后，再次排空。以该目录为工作目录的静态后端，以及尚未协调解决的准备恢复记录，也可能阻止完成。

准入关闭状态在运行时重启及规范化路径删除后重建时仍然保留。放弃移除时，必须显式[恢复准入](/zh/commands/project/resume)。

排空保留已准备的索引和配置，不删除目录，也不证明其他运行时和无关进程已释放该目录。请遵循[管理器移除流程](/zh/commands/project/#管理器移除流程)。
