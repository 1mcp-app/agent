---
title: Backend Logs
description: Inspect managed stdio backend stderr in the authenticated Admin Console.
---

# Backend Logs

Open **Logs** in the Admin Console to inspect stderr emitted by managed stdio backends. Each configured server or template instance has its own source. The selected source updates live, while inactive sources show an unread count without rendering their entries.

The runtime captures stderr only when it owns the stream: the default stdio configuration and managed `pipe` or Windows `overlapped` destinations. Stdio stdout remains MCP protocol traffic and is never treated as a log. Remote HTTP and SSE backends are not collected. A stdio server with an explicit unmanaged stderr destination such as `inherit`, `ignore`, or a numeric file descriptor is listed as unavailable instead of being overridden.

## Retention and privacy

Backend logs are an in-memory diagnostic view, not an audit record:

- secrets and terminal control sequences are sanitized before an entry reaches either the Admin Console or the runtime logger;
- raw stderr is not retained;
- each source retains up to 1 MiB, with a 32 MiB limit across the runtime;
- oldest entries are evicted first, and reconnecting across an eviction replaces the view with a fresh snapshot;
- history is lost when the aggregated runtime restarts.

Static server sources keep the same identity when their child process is replaced or when the server is disabled and enabled. A template instance keeps its source while that instance is replaced, but a newly created instance receives a new source. Ended sources remain visible only while retained history exists.

The Logs workspace uses the same authenticated Admin Session as the rest of the console. Expired or revoked sessions terminate the live stream. If the connection is interrupted, the workspace reconnects and resumes from the last retained sequence without duplicating entries.
