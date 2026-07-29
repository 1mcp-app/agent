---
title: Wait 命令 - 等待静态 MCP 服务器
description: 在调用工具前等待已配置的静态 MCP 服务器连接完成。
---

# Wait 命令

通过已认证的 `/api/v1/inspect` 状态契约，等待已启用的已配置静态 MCP 服务器变为 connected。

```bash
npx -y @1mcp/agent wait [server] [options]
```

不指定服务器时，`wait` 会等待所有匹配的已配置静态服务器。模板和已禁用服务器会被排除。模板目标返回 `server_not_load_tracked`，未知目标返回 `server_not_found`。

## 选项

- **`[server]`** - 要等待的一个已配置静态服务器
- **`--timeout <ms>`** - 正整数毫秒超时，默认 `30000`
- **`--url, -u <url>`** - 覆盖自动检测到的运行时 URL
- **`--context <name>`** - 使用命名 Runtime Target Context
- **`--preset`、`--tag-filter`、`--tags`** - 使用与 `inspect` 相同的面向客户端筛选
- **`--format <toon|text|json>`** - 选择成功输出格式

## 行为

只有所有请求服务器均为 `connected` 且 `available` 时才成功。`failed`、`cancelled`、`awaiting_oauth` 和不可用终态会立即以结构化非零错误结束。超时会包含最后观察到的状态和恢复命令。等待绝不会取消后台加载。

当脚本依赖刚启动的后端时，请在 `run` 前使用 `wait`。`run` 也会在 REST-to-MCP 回退前检查 inspect 状态；后端仍在加载时会返回带相同恢复命令的 `server_loading`。
