---
title: Operational telemetry
description: Enable optional OTLP traces and metrics, inspect runtime state, and disable export safely.
---

# Operational telemetry

Use this guide to send 1MCP execution-health signals to an OpenTelemetry Collector. You need a 1MCP version supporting this feature and an accessible OTLP HTTP/protobuf receiver. A Collector is optional for normal operation. Export is disabled by default. Restart after configuration changes.

## Enable export

This example uses a POSIX shell. Remote Collectors require HTTPS; HTTP is allowed only on loopback. A private network address does not permit cleartext HTTP.

```sh
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com:4318
1mcp serve
```

Replace the example host with your receiver. A shared endpoint gets `/v1/traces` and `/v1/metrics` appended; signal-specific endpoints are complete URLs. Supply authentication headers through `OTEL_EXPORTER_OTLP_HEADERS` in a protected runtime environment, avoiding shell history and shared logs. See [telemetry configuration](/reference/telemetry) for exact variables, precedence, and bounds.

Tracing defaults to deterministic 10% sampling by trace ID, independent of the incoming sampled flag. Metrics are independent of trace sampling. An endpoint alone does not enable export. Each signal can select `none` independently.

## Collector receiver example

Use an existing Collector's HTTP/protobuf receiver when available. For a self-managed Collector, this minimal `collector.yaml` targets Collector 0.163.1. Set `OTEL_BACKEND_ENDPOINT` to your actual HTTPS telemetry backend. The receiver binds locally; remote access requires TLS or a protected HTTPS ingress.

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

Start it with `otelcol --config=collector.yaml`. If 1MCP runs on the same host, set its `OTEL_EXPORTER_OTLP_ENDPOINT` to `http://127.0.0.1:4318`. Backend authentication and storage remain Collector/backend responsibilities.

## Check delivery and state

In your Collector, confirm traces and metrics with `service.name=1mcp` or your configured service name. The default trace batch delay is five seconds and the metric interval is 60 seconds, so all signals do not appear immediately. `1mcp serve status` and authenticated Admin Runtime Health expose read-only telemetry state. Telemetry does not determine public readiness.

| State                  | Meaning                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `disabled`             | Signal not enabled                                                             |
| `starting`             | Requested, with no successful export yet                                       |
| `healthy`              | Successful export with no active degradation                                   |
| `degraded`             | Export failures, stale success, queue pressure, drops, or cardinality overflow |
| `stopping` / `stopped` | Cleanup in progress / completed                                                |

Three consecutive failures, no success for two expected intervals, sustained queue use of at least 75%, any drop, or cardinality overflow degrades telemetry. Two successful exports with queue use below 50% recover it. Aggregate state shows the worst active signal; all-disabled stays `disabled`. Status reports endpoint class without URLs, credentials, or certificates.

## Understand data and resource limits

Signals use closed operation categories and dimensions. Arguments, results, prompts, resource content, exact URIs/paths, headers, IPs, credentials, arbitrary identities, configured backend/tool names, environment values, and raw exception content are excluded. Unknown fields are rejected when signals are created. Unknown MCP methods classify as `other`. Local diagnostics and Backend Logs remain a separate local data domain; their contents are not authorized for export. See [logging and trace context](/guide/advanced/observability).

The default Resource contains only service name, actual package version, and a random non-persisted per-process instance ID. Only service name is operator-configurable. There are no automatic host, process, or container detectors. Reader series caps are 1,024 for histograms, 512 for monotonic counters, and 256 for other instruments. Overflow degrades telemetry without changing MCP results or readiness.

OTLP Logs, baggage, exemplars, Prometheus/Zipkin/console exporters, product analytics, and a local telemetry database are unsupported. Providers run only in the actual aggregated runtime worker and long-running proxy. Management commands and detached supervisors do not start exporters.

## Troubleshoot and roll back

- No data: check signal selectors, receiver paths, TLS/authentication, and sampling. Endpoint configuration alone does not activate signals.
- Startup failure: correct invalid variables or unsupported exporter/protocol choices, then restart. Requested invalid providers do not silently start with degraded configuration.
- `degraded`: inspect Collector reachability, throttling, and capacity. Telemetry degradation does not imply MCP unavailability.
- Shutdown: telemetry flush gets at most five seconds within existing lifecycle deadlines. Failure preserves the original exit result. Forced termination may lose pending data.

To roll back, set these selectors and restart the runtime. W3C context propagation remains independent.

```sh
export OTEL_TRACES_EXPORTER=none
export OTEL_METRICS_EXPORTER=none
export OTEL_LOGS_EXPORTER=none
```

`OTEL_SDK_DISABLED=true` also disables signals and export. There are no write-capable Admin telemetry controls or hot provider replacement.
