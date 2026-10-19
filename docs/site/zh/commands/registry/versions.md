---
title: registry versions
description: 列出一个 MCP 注册表条目的可用版本。
---

# registry versions

```bash
1mcp registry versions <server-id> [options]
```

`server-id` 为必填项，应使用 `registry search` 返回的精确 ID。

## 选项

- `--format <table|json|detailed>`：输出格式。默认值：`table`。

## 示例

```bash
1mcp registry versions io.github.containers/kubernetes-mcp-server
1mcp registry versions io.github.containers/kubernetes-mcp-server --format detailed
1mcp registry versions io.github.containers/kubernetes-mcp-server --format json
```

共享注册表连接选项请参阅[注册表命令](/zh/commands/registry/)。
