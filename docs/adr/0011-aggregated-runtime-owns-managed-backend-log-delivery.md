---
status: accepted
---

# Aggregated Runtime Owns Managed Backend Log Delivery

The **Aggregated Runtime** owns one structured pipeline for captured stdio backend stderr. After per-backend ingestion isolation, content is sanitized once and becomes a **Managed Backend Log**; the same record is projected to terminal/file logging and to the authenticated **Admin Console**. Raw stderr is never retained, and the console does not tail the optional, rotated, mixed-format runtime log file.

The runtime retains **Backend Log History** in memory only, evicting oldest entries at 1 MiB per **Backend Log Source** and 32 MiB per runtime. Static sources follow configured server identity across child replacement and disable/enable cycles. Template sources follow canonical **Template Server Identity**: supervised replacement keeps one source, while recreation produces a new source and an ended source remains observable only while retained history exists.

The **Admin Console** receives retained snapshots and one same-origin, **Admin Session**-authorized event stream while its Logs workspace is active. A runtime-wide sequence supports replay after reconnect; an evicted cursor produces an explicit gap and snapshot replacement. Slow subscribers are bounded and disconnected for resynchronization rather than applying backpressure to log ingestion or MCP traffic.

## Considered Options

- Tailing the runtime log file was rejected because file logging is optional, rotated, mixes runtime and backend records, and is not a stable structured contract.
- Polling snapshots or opening one stream per tab was rejected because both create avoidable gaps and repeated work; one multiplexed stream keeps source tabs as presentation state.
- Retaining raw stderr for privileged reveal was rejected because it would create a broader secret-exposure surface than the normalized Admin Console contract.

## Consequences

Log history resets with the **Aggregated Runtime** and is not audit evidence. Stdio stdout remains MCP protocol traffic, remote HTTP/SSE backend logs are not collected, and explicit unmanaged stderr destinations appear as unavailable rather than being overridden.
