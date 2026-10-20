---
title: 检查 Project 生命周期状态
description: 检查选定运行时中的目录准入状态与清理阻塞项。
---

# project status

检查准入、所有者、活动任务及清理阻塞项，不创建绑定、不启动准备，也不延长空闲期限。

## 用法

```bash
1mcp project status --project /work/frontend --format json
```

使用 `--project` 选择目录，或显式选择 `--project-set` 中的成员。通过相同的 `--context` 或 `--url` 选择需要检查的运行时。支持 `--format text` 和 `--format json`。

## 解读结果

JSON 输出包含 `results` 数组，每个目录对应一个结果：

| 字段           | 含义                                         |
| -------------- | -------------------------------------------- |
| `checkoutPath` | 规范化的检出目录路径。                       |
| `admission`    | `open` 接受新工作；`draining` 保持准入关闭。 |
| `complete`     | 当前运行时是否已完成该目录的清理。           |
| `blockers`     | 仍阻止完成的所有者、活动任务或资源。         |

检查成功时退出码为零，即使 `complete` 为 false。不能仅凭该退出码判断目录可以移除。删除目录前请遵循[管理器移除流程](/zh/commands/project/#管理器移除流程)。

查看准备任务应使用 [project prepare status](/zh/commands/project/prepare)。修改目录准入状态应使用 [drain](/zh/commands/project/drain) 或 [resume](/zh/commands/project/resume)。
