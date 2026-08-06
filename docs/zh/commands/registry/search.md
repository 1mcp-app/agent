---
title: registry search
description: 在已配置的 MCP 注册表中搜索条目。
---

# registry search

```bash
1mcp registry search [query] [options]
```

`query` 是可选文本，用于匹配服务器名称和描述。

## 选项

- `--status <active|archived|deprecated|all>`：服务器状态。默认值：`active`。
- `--type <npm|pypi|docker>`：包注册表类型。
- `--transport <stdio|sse|http>`：传输类型。
- `--limit <number>`：最大结果数。默认值：`20`；大于 `100` 的值会被限制。
- `--cursor <string>`：上一响应返回的游标。
- `--format <table|list|json>`：输出格式。默认值：`table`。

## 示例

```bash
1mcp registry search
1mcp registry search "file system"
1mcp registry search database --type npm --transport stdio --limit 5
1mcp registry search --status deprecated --format json
1mcp registry search --cursor next-page-cursor
```

该命令不支持类别、标签、正则表达式、排除、私有注册表或更新筛选器。

共享选项和其他查询命令请参阅[注册表命令](/zh/commands/registry/)。
