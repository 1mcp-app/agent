---
title: 运维遥测
description: 启用可选的 OTLP 追踪和指标，检查运行状态并安全停用。
---

# 运维遥测

使用本指南将 1MCP 的执行健康信息发送到 OpenTelemetry Collector。需要支持此功能的 1MCP 版本，以及可访问的 OTLP HTTP/protobuf 接收端。正常使用无需 Collector；默认不导出任何信号。配置更改后必须重启。

## 启用导出

以下为 POSIX shell 示例。远程 Collector 必须使用 HTTPS；HTTP 仅允许回环地址。不能因为目标位于私有网络就使用明文 HTTP。

```sh
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com:4318
1mcp serve
```

将示例域名替换为实际接收端。共享端点自动附加 `/v1/traces` 和 `/v1/metrics`；单信号端点使用完整 URL。认证头通过 `OTEL_EXPORTER_OTLP_HEADERS` 配置，例如从受保护的运行环境提供，勿写入命令历史或共享日志。完整变量、优先级及限制见[遥测配置](/zh/reference/telemetry)。

默认按 trace ID 确定性采样 10% 的追踪，不依赖传入 sampled 标志；指标不受追踪采样影响。仅设置端点不会开启导出。追踪和指标可分别选择 `none`。

## Collector 接收端示例

已有 Collector 可直接使用其 HTTP/protobuf 接收端。若自行部署，下面是与 Collector 0.163.1 配套的最小配置 `collector.yaml`；将 `OTEL_BACKEND_ENDPOINT` 设置为实际 HTTPS 遥测后端。接收端仅绑定本机，远程接入应配置 TLS 或在受保护的 HTTPS 入口后运行。

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 128
    spike_limit_mib: 32
  batch: {}
exporters:
  otlp_http:
    endpoint: ${env:OTEL_BACKEND_ENDPOINT}
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http]
```

使用 `otelcol --config=collector.yaml` 启动。若 1MCP 与 Collector 位于同一主机，将 1MCP 的 `OTEL_EXPORTER_OTLP_ENDPOINT` 设置为 `http://127.0.0.1:4318`。后端认证和持久化由 Collector/后端管理。

## 检查结果

在 Collector 中确认收到 `service.name=1mcp`（或配置的服务名）的追踪和指标。默认追踪批次延迟为 5 秒，指标间隔为 60 秒，因此启动后不会立即出现全部信号。`1mcp serve status` 和已认证的 Admin Runtime Health 提供只读遥测状态；公共 readiness 不由遥测决定。

| 状态                   | 含义                                             |
| ---------------------- | ------------------------------------------------ |
| `disabled`             | 未启用信号                                       |
| `starting`             | 已请求信号，尚未成功导出                         |
| `healthy`              | 已成功导出，当前未降级                           |
| `degraded`             | 导出失败、长时间无成功、队列压力、丢弃或基数溢出 |
| `stopping` / `stopped` | 正在停止 / 已停止                                |

连续三次失败、两个预期间隔无成功、持续队列占用至少 75%、任何丢弃或基数溢出均会降级。连续两次成功且队列低于 50% 后恢复。聚合状态显示活动信号中的最差状态；全部关闭时为 `disabled`。状态仅显示端点类别，不显示 URL、凭据或证书。

## 数据边界与资源限制

遥测使用封闭的操作类别和维度。参数、结果、提示词、资源内容、精确 URI/路径、请求头、IP、凭据、任意身份、配置的后端/工具名、环境值及原始异常内容均不导出。未知字段在创建信号时被拒绝。未知 MCP 方法归为 `other`。本地诊断和 Backend Logs 仍属于独立的本地数据域，不能据此推断其内容允许导出；参见[日志与追踪上下文](/zh/guide/advanced/observability)。

Resource 默认仅包含服务名、实际包版本和每进程随机的不持久化实例 ID。仅允许自定义服务名。无自动主机、进程或容器探测器。直方图、单调计数器、其他指标的每读取器序列上限分别为 1024、512、256；溢出会导致遥测降级，不改变 MCP 结果或 readiness。

不支持 OTLP Logs、baggage、exemplars、Prometheus/Zipkin/console 导出、产品分析或本地遥测数据库。此配置仅属于实际运行的聚合 worker 和长运行 proxy；管理命令或独立 supervisor 不启动导出器。

## 排障与回滚

- 无数据：检查两个 exporter 选择器、接收端路径、TLS/认证和采样；端点本身不启用信号。
- 启动失败：修复无效变量或不支持的 exporter/protocol，随后重启。不会通过降级配置悄悄启动。
- `degraded`：检查 Collector 可达性、限流及容量。不要将遥测降级视为 MCP 不可用。
- 关闭时：在现有生命周期截止时间内最多刷新 5 秒；失败不会改变原有退出结果。进程被强制终止时可能丢失待导出的数据。

回滚时设置以下变量并重启运行服务。已有 W3C 上下文传播保持独立。

```sh
export OTEL_TRACES_EXPORTER=none
export OTEL_METRICS_EXPORTER=none
export OTEL_LOGS_EXPORTER=none
```

`OTEL_SDK_DISABLED=true` 也会关闭信号和导出。没有写入型 Admin 控件或热替换 provider。
