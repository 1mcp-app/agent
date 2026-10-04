---
title: 仅追踪上下文传播的验证
description: 验证不启用 Provider 或 Exporter 的 W3C 上下文传播与隐私边界。
---

# 仅追踪上下文传播的验证

Issue #488 只安装 OpenTelemetry 异步上下文管理器和 W3C 追踪传播器，不创建 Provider、Span、Exporter、指标或 Baggage。即使设置 `OTEL_SDK_DISABLED=true`，消息级上下文传播也保持有效。

依赖版本固定为 `@opentelemetry/api` 1.9.0，以及 `@opentelemetry/context-async-hooks`、`@opentelemetry/core` 2.2.0。MCP 使用 `_meta.traceparent` 与 `_meta.tracestate`；HTTP 头中的上下文独立于 MCP 逻辑操作。不同的有效上下文不会改变授权、路由或请求结果。

## 测试与性能工作负载

构建后执行：

```sh
pnpm test:tracing:disabled
pnpm test:tracing:performance
pnpm test:e2e test/e2e/gateway-interactions-four-era.test.ts test/e2e/gateway-tracing-transports.test.ts test/e2e/tracing-disabled.test.ts
```

性能测试在测量前固定工作负载：同一进程和构建，4 KiB 工具请求，先预热 1,000 次，再交替运行五组基线和传播处理；每组 2,000 次操作，并发 32。分别测试缺失、有效和畸形上下文。每次操作解析 JSON、移除调用方元数据、让出一次微任务、生成出站请求及响应。

预先设定的风险门槛为：平均每次操作新增时间不超过 0.25 ms，p95 新增时间不超过 1 ms，显式 GC 后保留堆增长不超过 16 MiB。必须保持完成次数及业务结果一致，无操作外上下文，无出站 Baggage。相对吞吐量单独报告；此测试不代表网络延迟或完整服务吞吐量。

初次验证使用 Node v26.4.0、Darwin。有效上下文平均新增约 5.3 微秒，p95 新增约 0.176 ms，吞吐量约为基线的 0.638；缺失和畸形上下文平均新增不足 1 微秒。三种情况均满足上述绝对门槛。详细数据和测量解释见[英文验证记录](./propagation-verification.md)。

独立子进程测试分别在 SDK 禁用变量缺失和为 true 的情况下执行，并显式配置 OTLP 地址。拦截 HTTP、HTTPS、TCP、UDP 和 fetch 后，网络创建次数均为零；无有效本地 Span，无 Baggage。现有构建后 E2E 套件会持续执行该检查。

## 协议与隐私边界

四种入站/上游协议时代组合覆盖 Roots、Sampling、Elicitation、32 项输入和多轮继续请求。真实传输测试覆盖 Streamable HTTP、保留的 SSE、stdio 子进程，以及 legacy/modern stdio 代理。继续请求更换追踪元数据不会替换已授权操作的原始上下文。

MCP client 2.0.0 会在本地回调解析时移除嵌入式 Sampling/Elicitation 请求的 `_meta`，因此测试直接验证实际 HTTP 消息中的追踪字段。代理测试直接启动生产代理传输；CLI 目标发现及生命周期由既有测试覆盖。

请求 `_meta.baggage` 不会被提取，并在转发、反向请求、嵌入式输入请求的元数据重建时移除。结果 `_meta.baggage` 在 SDK、时代适配器、入站响应、交互响应及代理双向响应边界移除；其他结果元数据保持不变。`structuredContent.baggage`、工具参数等业务字段不会被递归删除。HTTP Baggage 不会复制到消息上下文。

本实现不授权发布或部署；发布后的观察与验收归属于 #490。
