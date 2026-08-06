---
title: 性能与恢复
description: 准确配置有界 stdio 后端恢复并使用 1MCP 运维信号。
---

# 性能与恢复

1MCP 将 MCP 流量转发到已配置的后端。请根据每个后端设置连接和请求超时，并使用日志和健康检查路由调查缓慢或不可用的服务。它不提供负载均衡、熔断器、连接池或正常运行时间保证。

## 有界 Stdio 恢复

自动恢复需要显式启用，且仅适用于 `stdio` 后端服务器。当子进程退出后仍应被监督时，在 `mcp.json` 中设置 `restartOnExit`：

```json
{
  "mcpServers": {
    "local-tool": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "restartOnExit": true,
      "maxRestarts": 5,
      "restartDelay": 1000
    }
  }
}
```

`maxRestarts` 是连续自动重启的最大尝试次数：省略时为 `5`，设为 `0` 表示不限制次数，也可以指定正数上限。稳定运行五分钟后，尝试计数会重置。`restartDelay` 是以毫秒为单位的初始延迟；连续失败依次等待该值的 1、2、4、8 倍，之后最大为 16 倍。

HTTP、SSE 和 streamable HTTP 后端条目会忽略这些监督设置。恢复并不承诺失败的后端一定可用，因此调用方仍需处理 MCP 错误，并在关键操作前检查目标服务。

## 运维信号

- 使用 `/health/ready` 判断 HTTP 运行时是否可以接收流量；它不表示每个后端都已就绪。
- 使用 `/health/mcp` 查看后端加载和重试进度。
- 在调用已知后端前，使用已认证的 `inspect` API 或 `1mcp inspect` 查看面向客户端的状态。
- 排查事件时设置 `ONE_MCP_LOG_LEVEL=debug`，随后恢复到合适的生产日志级别。

有关启动行为和目录发布，请参阅[快速启动](/zh/guide/advanced/fast-startup)。有关服务器配置契约，请参阅[MCP 服务器参考](/zh/reference/mcp-servers)。
