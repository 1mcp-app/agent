---
title: 生产运维
description: 规划自托管 1MCP 运行时的部署、配置、就绪检查与恢复。
---

# 生产运维

1MCP 运行时管理后端连接，并为本地 STDIO 后端管理子进程。容量规划应同时考虑代理与后端。托管、升级、备份、监控和恢复仍由运维人员负责。

## 选择部署方式

- [云端部署](/zh/guide/advanced/cloud-deployment) 介绍使用 Caddy 发布 HTTPS 服务。
- [反向代理](/zh/guide/advanced/reverse-proxy) 介绍转发、公共 URL 和代理信任。
- [Windows 任务计划程序](/zh/guide/advanced/windows-task-scheduler) 介绍 Windows 无人值守启动。

对外提供服务前，请配置认证并限制网络访问。仅信任实际使用的反向代理，参阅[安全指南](/zh/guide/advanced/security)。

## 分离配置与凭据

后端定义放在 `mcp.json`，运行时设置放在 `config.toml`。显式命令行参数优先于 `ONE_MCP_*` 环境变量，环境变量优先于配置默认值。参阅[配置指南](/zh/guide/essentials/configuration)。

后端环境变量引用示例：

```json
{
  "mcpServers": {
    "database": {
      "command": "mcp-postgres",
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    }
  }
}
```

此示例要求已安装后端可执行文件，并在所选运行时的环境或受支持的环境文件中提供 `DATABASE_URL`。环境变量引用不会从外部密钥存储获取凭据。文件位置和继承规则见[环境管理](/zh/reference/mcp-servers#高级环境管理)。

## 分别检查运行时和后端就绪状态

| 信号            | 能确认的事实                               |
| --------------- | ------------------------------------------ |
| `/health/live`  | HTTP 进程响应存活探针                      |
| `/health/ready` | 运行时可以接受流量；不要求所有后端均已就绪 |
| `/health/mcp`   | 后端加载诊断；信息级别过滤仅适用于监督数据 |
| `1mcp inspect`  | 所选客户端可见的能力和服务器状态           |

`/health` 响应默认采用信息量最少的级别。即使在此级别，诊断用的 `/health/mcp` 路由仍可能暴露后端错误信息和授权 URL，且不受 MCP 认证保护。请在网络或反向代理边界限制这些路由的访问。具体响应结构、状态码和探针示例见[健康检查 API](/zh/reference/health-check)。请配置监控系统采集这些信号并发送告警；这并不意味着产品内置了告警回调（Webhook）功能。

异步加载允许运行时在所有后端连接完成前提供服务。调用前请确认任务所需的后端已就绪，参阅[快速启动](/zh/guide/advanced/fast-startup)。

## 规划恢复与升级

使用[后端日志](/zh/guide/advanced/backend-logs)和[追踪上下文](/zh/guide/advanced/observability)调查故障。STDIO 进程监督需要显式启用，且重试次数受限，参阅[性能与恢复](/zh/guide/advanced/performance)。后端重启并不意味着失败的工具调用可以安全重放。

升级前备份所选配置并规划客户端重连方式。更新后分别验证运行时就绪、后端发现和一项已获授权的代表性操作。

## 多实例

1MCP 不提供分布式会话存储、集群协调器或负载均衡器。不要假定共享配置文件或粘性路由会复制 OAuth 状态、项目所有权或后端连接。将每个运行时视为独立的运维范围，并在依赖外部路由和恢复方案前进行验证。
