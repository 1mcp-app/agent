---
title: registry show
description: 显示一个 MCP 注册表条目。
---

# registry show

```bash
1mcp registry show <server-id> [options]
```

`server-id` 为必填项，应使用 `registry search` 返回的精确 ID。

## 选项

- `--ver, -v <version>`：显示特定版本。
- `--format <table|json|detailed>`：输出格式。默认值：`detailed`。

## 示例

```bash
1mcp registry show io.github.containers/kubernetes-mcp-server
1mcp registry show io.github.containers/kubernetes-mcp-server --ver 1.0.0
1mcp registry show io.github.containers/kubernetes-mcp-server --format json
```

共享注册表连接选项请参阅[注册表命令](/zh/commands/registry/)。
