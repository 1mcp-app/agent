---
title: 遥测配置
description: 运维追踪与指标的标准 OTEL 环境变量、默认值及限制。
---

# 遥测配置

此页用于精确查询。启用、验证与回滚流程见[运维遥测指南](/zh/guide/advanced/operational-telemetry)。全部配置仅在启动时读取；更改后重启。未设置与空字符串均使用默认值。下面的默认值属于 1MCP 安全配置，不应以通用 SDK 默认值替代。

## 信号、Resource、采样与限额

| 变量                                     | 默认值         | 行为与限制                                                                                                        |
| ---------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `OTEL_SDK_DISABLED`                      | `false`        | true 关闭 provider 与导出，传播保持独立                                                                           |
| `OTEL_TRACES_EXPORTER`                   | `none`         | otlp 或 none；空值为 none                                                                                         |
| `OTEL_METRICS_EXPORTER`                  | `none`         | otlp 或 none；空值为 none                                                                                         |
| `OTEL_LOGS_EXPORTER`                     | `none`         | 仅 none，其他值导致启动失败                                                                                       |
| `OTEL_SERVICE_NAME`                      | `1mcp`         | 覆盖 Resource 属性中的 service.name                                                                               |
| `OTEL_RESOURCE_ATTRIBUTES`               | `—`            | 仅接纳 service.name；其他键丢弃并输出脱敏警告                                                                     |
| `OTEL_TRACES_SAMPLER`                    | `traceidratio` | 支持 always_on、always_off、traceidratio、parentbased_always_on、parentbased_always_off、parentbased_traceidratio |
| `OTEL_TRACES_SAMPLER_ARG`                | `0.1`          | 未指定 sampler 时为 0.1；显式 ratio sampler 默认 1；范围 0–1                                                      |
| `OTEL_BSP_MAX_QUEUE_SIZE`                | `2048`         | 1–8192 个 Span                                                                                                    |
| `OTEL_BSP_MAX_EXPORT_BATCH_SIZE`         | `512`          | 1–2048；大于队列时归一化为队列大小                                                                                |
| `OTEL_BSP_SCHEDULE_DELAY`                | `5000`         | 1–60000 毫秒                                                                                                      |
| `OTEL_BSP_EXPORT_TIMEOUT`                | `10000`        | 1–30000 毫秒                                                                                                      |
| `OTEL_METRIC_EXPORT_INTERVAL`            | `60000`        | 5000–300000 毫秒                                                                                                  |
| `OTEL_METRIC_EXPORT_TIMEOUT`             | `10000`        | 1–30000 毫秒                                                                                                      |
| `OTEL_ATTRIBUTE_COUNT_LIMIT`             | `32`           | 0–32，通用属性数量上限                                                                                            |
| `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT`      | `256`          | 0–256 UTF-8 字节                                                                                                  |
| `OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT`        | `32`           | 覆盖通用设置；硬上限为 32                                                                                         |
| `OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT` | `256`          | 覆盖通用设置；硬上限为 256 UTF-8 字节                                                                             |
| `OTEL_SPAN_EVENT_COUNT_LIMIT`            | `16`           | 0–16                                                                                                              |
| `OTEL_SPAN_LINK_COUNT_LIMIT`             | `8`            | 0–8                                                                                                               |
| `OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT`       | `16`           | 0–16                                                                                                              |
| `OTEL_LINK_ATTRIBUTE_COUNT_LIMIT`        | `16`           | 0–16                                                                                                              |

## OTLP 导出

单信号非空配置优先于共享配置。以下逐项列出三个确切变量名。单位均为毫秒（时间项）。远程地址仅 HTTPS；HTTP 仅允许 localhost、127.0.0.0/8 和 ::1 回环地址。凭据应置于 header，不得置于 URL。

| 变量（共享；追踪；指标）                                                                                                                 | 默认值                  | 行为                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`; `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`; `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`                               | `http://localhost:4318` | 共享基地址附加 /v1/traces 或 /v1/metrics；单信号 URL 原样使用 |
| `OTEL_EXPORTER_OTLP_PROTOCOL`; `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`; `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL`                               | `http/protobuf`         | 仅 http/protobuf                                              |
| `OTEL_EXPORTER_OTLP_HEADERS`; `OTEL_EXPORTER_OTLP_TRACES_HEADERS`; `OTEL_EXPORTER_OTLP_METRICS_HEADERS`                                  | `—`                     | 逗号分隔 key=value，值使用百分号编码；单信号配置替换共享映射  |
| `OTEL_EXPORTER_OTLP_TIMEOUT`; `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`; `OTEL_EXPORTER_OTLP_METRICS_TIMEOUT`                                  | `10000`                 | 1–30000 毫秒                                                  |
| `OTEL_EXPORTER_OTLP_COMPRESSION`; `OTEL_EXPORTER_OTLP_TRACES_COMPRESSION`; `OTEL_EXPORTER_OTLP_METRICS_COMPRESSION`                      | `none`                  | none 或 gzip                                                  |
| `OTEL_EXPORTER_OTLP_CERTIFICATE`; `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE`; `OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE`                      | `—`                     | PEM CA 证书文件路径                                           |
| `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`; `OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE`; `OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE` | `—`                     | PEM 客户端证书路径，须同时设置 CLIENT_KEY                     |
| `OTEL_EXPORTER_OTLP_CLIENT_KEY`; `OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY`; `OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY`                         | `—`                     | PEM 客户端私钥路径，须同时设置 CLIENT_CERTIFICATE             |

## 无效或不支持的配置

显式不支持的信号选择器、多个 exporter、非 HTTP/protobuf 协议、非 none 的 Logs exporter，以及非空 `OTEL_CONFIG_FILE` 均导致 readiness 前启动失败。其他被识别但不支持的 OTEL 配置仅产生一次脱敏警告，不输出值。未知 Resource 键被丢弃。上限只能降低，不能通过标准 SDK 变量提高。无配置可开启 baggage、exemplars、自动探测器或 SDK 自监控指标。

`OTEL_SDK_DISABLED=true` 关闭信号和网络导出，但不授予无效配置例外。端点、headers、密钥、证书和环境值不显示在运行状态或诊断中。版本和实例身份由运行时拥有，不能通过 Resource 属性覆盖。

## MCP 指标约定

`mcp.client.operation.duration` 与 `mcp.server.operation.duration` 使用秒（`s`）记录完整操作时长，以直方图 count 提供操作总数。实现采用 [semantic-conventions-genai 固定版本 f49da22056925ae9ba78ec5dd7fe1fa559adce05](https://github.com/open-telemetry/semantic-conventions-genai/blob/f49da22056925ae9ba78ec5dd7fe1fa559adce05/docs/gen-ai/mcp.md) 的名称、单位与时长语义，并按 1MCP 的隐私约定限制维度。这是隐私受限的投影，不表示完整符合该实验性约定；建议的后端/工具/资源身份属性被排除。无冗余请求计数器，也不虚构现代协议会话指标。
