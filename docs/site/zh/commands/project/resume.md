---
title: 恢复 Project 准入
description: 显式允许已排空的目录重新接受工作。
---

# project resume

要求本地操作员权限，重新开放单个目录的准入。放弃移除目录，或需要再次使用已排空的目录时执行此命令。

## 用法

```bash
1mcp project resume --project /work/frontend --format json
```

必须选择恰好一个目录，并通过 `--context` 或 `--url` 使用相同运行时。请求中声称的操作员角色不会授予权限；运行时验证本地凭证，并继续执行认证要求。

## 结果

成功响应包含 `admission: open`，应检查该字段以确认准入已恢复。恢复不会准备或启动后端、恢复已释放的所有者绑定，也不会清除现有阻塞项。

后端需要准备时，使用 [project prepare](/zh/commands/project/prepare)。只读检查使用 [project status](/zh/commands/project/status)。重复恢复不会删除已准备的索引和配置。
