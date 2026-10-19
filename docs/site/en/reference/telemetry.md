---
title: Telemetry configuration
description: Exact standard OTEL variables, defaults, and bounds for operational traces and metrics.
---

# Telemetry configuration

Use this page for exact lookup. See the [operational telemetry guide](/guide/advanced/operational-telemetry) to enable, verify, or disable export. All settings are read at startup and require restart. Unset and empty strings use defaults. These are 1MCP safety defaults; do not substitute generic SDK defaults.

## Signals, Resource, sampling, and limits

| Variable                                 | Default        | Behavior and bounds                                                                                          |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `OTEL_SDK_DISABLED`                      | `false`        | true disables providers and export; propagation remains independent                                          |
| `OTEL_TRACES_EXPORTER`                   | `none`         | otlp or none; empty means none                                                                               |
| `OTEL_METRICS_EXPORTER`                  | `none`         | otlp or none; empty means none                                                                               |
| `OTEL_LOGS_EXPORTER`                     | `none`         | Only none; other values fail startup                                                                         |
| `OTEL_SERVICE_NAME`                      | `1mcp`         | Overrides service.name from Resource attributes                                                              |
| `OTEL_RESOURCE_ATTRIBUTES`               | `—`            | Only service.name admitted; other keys dropped with sanitized warning                                        |
| `OTEL_TRACES_SAMPLER`                    | `traceidratio` | always_on, always_off, traceidratio, parentbased_always_on, parentbased_always_off, parentbased_traceidratio |
| `OTEL_TRACES_SAMPLER_ARG`                | `0.1`          | Default 0.1 when sampler omitted; explicit ratio sampler defaults to 1; ratio 0–1                            |
| `OTEL_BSP_MAX_QUEUE_SIZE`                | `2048`         | 1–8192 spans                                                                                                 |
| `OTEL_BSP_MAX_EXPORT_BATCH_SIZE`         | `512`          | 1–2048; normalized to queue size when larger                                                                 |
| `OTEL_BSP_SCHEDULE_DELAY`                | `5000`         | 1–60000 ms                                                                                                   |
| `OTEL_BSP_EXPORT_TIMEOUT`                | `10000`        | 1–30000 ms                                                                                                   |
| `OTEL_METRIC_EXPORT_INTERVAL`            | `60000`        | 5000–300000 ms                                                                                               |
| `OTEL_METRIC_EXPORT_TIMEOUT`             | `10000`        | 1–30000 ms                                                                                                   |
| `OTEL_ATTRIBUTE_COUNT_LIMIT`             | `32`           | 0–32; sets general attribute ceiling                                                                         |
| `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT`      | `256`          | 0–256 UTF-8 bytes                                                                                            |
| `OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT`        | `32`           | May lower general ceiling; cannot raise it                                                                   |
| `OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT` | `256`          | May lower general byte ceiling; cannot raise it                                                              |
| `OTEL_SPAN_EVENT_COUNT_LIMIT`            | `16`           | 0–16                                                                                                         |
| `OTEL_SPAN_LINK_COUNT_LIMIT`             | `8`            | 0–8                                                                                                          |
| `OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT`       | `16`           | 0–16                                                                                                         |
| `OTEL_LINK_ATTRIBUTE_COUNT_LIMIT`        | `16`           | 0–16                                                                                                         |

## OTLP export

A nonempty signal-specific setting overrides its shared setting. Each row lists all three exact variable names. Time values use milliseconds. Remote endpoints require HTTPS; HTTP is restricted to localhost, 127.0.0.0/8, and ::1 loopback. Supply credentials as headers, never URL credentials.

| Variables (shared; traces; metrics)                                                                                                      | Default                 | Behavior                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`; `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`; `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`                               | `http://localhost:4318` | Shared base URL appends /v1/traces or /v1/metrics; signal-specific URL used verbatim     |
| `OTEL_EXPORTER_OTLP_PROTOCOL`; `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`; `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL`                               | `http/protobuf`         | Only http/protobuf                                                                       |
| `OTEL_EXPORTER_OTLP_HEADERS`; `OTEL_EXPORTER_OTLP_TRACES_HEADERS`; `OTEL_EXPORTER_OTLP_METRICS_HEADERS`                                  | `—`                     | Comma-separated key=value pairs; percent-encode values; signal value replaces shared map |
| `OTEL_EXPORTER_OTLP_TIMEOUT`; `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`; `OTEL_EXPORTER_OTLP_METRICS_TIMEOUT`                                  | `10000`                 | 1–30000 ms                                                                               |
| `OTEL_EXPORTER_OTLP_COMPRESSION`; `OTEL_EXPORTER_OTLP_TRACES_COMPRESSION`; `OTEL_EXPORTER_OTLP_METRICS_COMPRESSION`                      | `none`                  | none or gzip                                                                             |
| `OTEL_EXPORTER_OTLP_CERTIFICATE`; `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE`; `OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE`                      | `—`                     | PEM CA certificate file path                                                             |
| `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`; `OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE`; `OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE` | `—`                     | PEM client certificate path; requires CLIENT_KEY                                         |
| `OTEL_EXPORTER_OTLP_CLIENT_KEY`; `OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY`; `OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY`                         | `—`                     | PEM client private key path; requires CLIENT_CERTIFICATE                                 |

## Invalid and unsupported settings

Explicit unsupported signal selectors, multiple exporters, protocols other than HTTP/protobuf, non-none Logs export, and nonempty `OTEL_CONFIG_FILE` fail before readiness. Other recognized unsupported OTEL settings produce a sanitized warning once without values. Unknown Resource keys are dropped. Limits may be lowered, never raised through SDK variables. No setting enables baggage, exemplars, automatic detectors, or SDK self-metrics.

`OTEL_SDK_DISABLED=true` disables signals and network export; it does not make invalid configuration valid. Endpoint URLs, headers, keys, certificates, and environment values stay out of runtime status and diagnostics. Version and instance identity remain runtime-owned and cannot be overridden through Resource attributes.

## MCP metric conventions

`mcp.client.operation.duration` and `mcp.server.operation.duration` record full operation duration in seconds (`s`); histogram counts supply operation totals. Names, units, and duration semantics use [semantic-conventions-genai revision f49da22056925ae9ba78ec5dd7fe1fa559adce05](https://github.com/open-telemetry/semantic-conventions-genai/blob/f49da22056925ae9ba78ec5dd7fe1fa559adce05/docs/gen-ai/mcp.md), with dimensions restricted by the 1MCP privacy contract. This is a privacy-limited projection, not full compliance with that experimental convention: recommended backend/tool/resource identity attributes are excluded. There is no redundant request counter or fabricated modern session metric.
