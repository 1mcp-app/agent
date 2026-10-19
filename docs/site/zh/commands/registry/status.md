---
title: registry status
description: 检查已配置 MCP 注册表的可用性。
---

# registry status

```bash
1mcp registry status [options]
```

## 选项

- `--stats`：包含服务器计数统计。默认值：`false`。
- `--json`：以 JSON 输出结果。默认值：`false`。

## 示例

```bash
1mcp registry status
1mcp registry status --stats
1mcp registry status --stats --json
```

共享注册表连接选项请参阅[注册表命令](/zh/commands/registry/)。
