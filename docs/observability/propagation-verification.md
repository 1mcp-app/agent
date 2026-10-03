# Propagation-only verification

Issue #488 does not activate providers, spans, exporters, metrics, or baggage. The launcher installs only the OpenTelemetry context manager and W3C trace propagator. SDK disable/export environment variables cannot switch this propagation off or activate network export.

Selected released packages: `@opentelemetry/api` 1.9.0, `@opentelemetry/context-async-hooks` 2.2.0, and `@opentelemetry/core` 2.2.0. The [versioned W3C propagator implementation](https://github.com/open-telemetry/opentelemetry-js/blob/v2.2.0/packages/opentelemetry-core/src/trace/W3CTraceContextPropagator.ts) and [MCP metadata contract](https://modelcontextprotocol.io/specification/2026-07-28/basic) define the adapter boundary. The installed 2.2 injector expects the sampled flag bit; outbound injection masks reserved bits accordingly. No upstream OTel objects cross the tracing facade.

## Workloads defined before measurement

Run `node --expose-gc scripts/measure-propagation.mjs` after `pnpm build`. This measures matched in-process protocol processing with and without propagation on the same host, Node executable, compiled source, payload, operation count and concurrency. It does not estimate network latency or full product throughput.

Each operation parses a 4 KiB tool request, strips caller `_meta`, yields one microtask, serializes its gateway-generated outbound request and response, and completes. Cases are absent context, valid W3C parent/state with prohibited baggage, and malformed/conflicting context. Each case warms up 1,000 operations, then alternates baseline and propagation batches (five rounds of 2,000 operations, 32 concurrent operations). Baseline performs the identical business processing without context extraction/activation/injection. Treatment additionally reads correlation, asserting baggage is absent from outbound metadata.

Risks and gates fixed before measurement:

- Per-operation context overhead must add no more than 0.25 ms to mean processing cost and 1 ms to p95 operation latency. Report relative throughput as a diagnostic; tiny in-process baselines amplify percentages.
- After 10,000 completed operations and explicit GC, retained heap growth must remain below 16 MiB per case. The bounds cover operation context cleanup, not arbitrary provider or application heaps.
- Completion count and protocol results must match; there must be no active context left outside each operation, no baggage in metadata, and no correlation for malformed/absent context.

These bounds target synchronous parsing, async context isolation, cleanup, and bounded carrier work. Real transport tests separately cover the four era cells, Streamable HTTP, retained SSE, stdio upstream/proxy, reverse interactions and continuations. Export-disabled subprocess tests intercept network creation and assert no valid locally created span. Release canary and post-release watch belong to #490; this implementation authorizes no release.

## Initial implementation measurements

Command: `pnpm test:tracing:performance`, Node v26.4.0, Darwin; same checkout/build and process for each alternating pair. All three predefined absolute latency/retained-heap bounds passed. This is propagation-only in-process evidence, not a full runtime throughput claim.

| Case      | Baseline / treatment total ms | Added mean ms/op | Added p95 ms | Throughput ratio | Retained heap delta bytes |
| --------- | ----------------------------- | ---------------- | ------------ | ---------------- | ------------------------- |
| Absent    | 92.998 / 101.833              | 0.000884         | 0.057833     | 0.913            | 216728                    |
| Valid     | 93.140 / 145.979              | 0.005284         | 0.175876     | 0.638            | -49936                    |
| Malformed | 95.012 / 104.798              | 0.000979         | 0.046750     | 0.907            | -14568                    |

The valid-carrier microbenchmark processes approximately 36% fewer operations per second than its very short uninstrumented baseline, while adding about 5.3 microseconds per operation. Both values are reported to avoid interpreting an absolute latency gate as a throughput guarantee. Negative heap deltas reflect collection noise, not negative memory use.

`pnpm test:tracing:disabled` passed fresh subprocesses with `OTEL_SDK_DISABLED` unset and true, and an explicit OTLP endpoint configured: context propagation remained active, no provider created a valid local span, no baggage was stored, and intercepted HTTP/HTTPS/TCP/UDP/fetch connection counts stayed zero. `test/e2e/tracing-disabled.test.ts` runs this check in the existing post-build E2E suite.

The four-era interaction fixture verifies Roots/Sampling/Elicitation and continuation carriers at the actual HTTP wire. Released MCP client 2.0.0 removes embedded sampling/elicitation `_meta` while parsing the local callback; that upstream SDK behavior is distinct from wire delivery. Valid differing HTTP headers and changed continuation metadata do not replace the original owned operation context. Separate transport fixtures cover retained SSE and Streamable HTTP inbound to a real stdio child, plus legacy/modern stdio proxy processes. The proxy fixture launches the production proxy transport directly; CLI target discovery/ownership remains covered by the existing CLI tests.

## Carrier privacy boundary

Request `_meta.baggage` is never extracted and is removed when gateway request metadata is regenerated, including reverse requests and embedded input requests. Reserved result `_meta.baggage` is removed at legacy/modern SDK and era result boundaries, on legacy inbound responses, on interaction responses, and in both proxy response directions. Other result metadata remains unchanged. Application fields such as `structuredContent.baggage`, tool arguments, or content with a property named `baggage` remain ordinary business data. HTTP headers are not tracing parents and HTTP baggage is never copied into message context.
