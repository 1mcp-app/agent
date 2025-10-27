---
title: Fast Startup - Async Server Loading
description: Learn how to enable async server loading in 1MCP. Start immediately with real-time capability updates for better performance.
head:
  - ['meta', { name: 'keywords', content: 'fast startup,async loading,performance,speed optimization' }]
  - ['meta', { property: 'og:title', content: '1MCP Fast Startup Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Enable async server loading for faster 1MCP startup with real-time updates.',
      },
    ]
---

# Fast Startup: Async Server Loading

Get your 1MCP agent running instantly with real-time capability updates, even when some servers take time to connect.

## What's This About?

When you start 1MCP, it needs to connect to all your configured MCP servers. Previously, if even one server was slow or unreachable, your entire 1MCP instance would be stuck waiting. Now, 1MCP starts immediately and connects to servers in the background, sending real-time `listChanged` notifications to clients as capabilities become available.

## The Problem We Solved

**Before**:

- 1MCP waits for ALL servers before starting
- One slow server = entire system stuck
- Network issues block your workflow

**Now**:

- 1MCP starts in under 1 second
- Servers connect in the background
- Real-time notifications as capabilities become available
- You can work immediately with available servers

## How It Works

```mermaid
graph TD
    A[Start 1MCP] --> B[HTTP Server Ready <1s]
    B --> C[Background: Connect to MCP Servers]
    C --> D[Server 1: Ready ✅]
    C --> E[Server 2: Loading ⏳]
    C --> F[Server 3: Failed ❌]
    D --> G[Full Functionality Available]
    E --> G
    F --> H[Retry in Background]
    H --> G
```

## Server States

| State              | Icon | What It Means                   | What You Can Do              |
| ------------------ | ---- | ------------------------------- | ---------------------------- |
| **Ready**          | ✅   | Server connected successfully   | Full functionality available |
| **Loading**        | ⏳   | Server connecting in background | Wait or use other servers    |
| **Failed**         | ❌   | Connection failed, will retry   | Check server config/network  |
| **Awaiting OAuth** | 🔐   | Needs authorization             | Complete OAuth flow          |

## Monitor Your Servers

### Quick Health Check

```bash
curl http://localhost:3000/health/mcp
```

### Individual Server Status

```bash
curl http://localhost:3000/health/mcp/context7
```

## Benefits for You

### ⚡ Instant Startup

- 1MCP ready in <1 second regardless of server count
- No more waiting for slow connections
- Start working immediately

### 🛡️ Resilient Operation

- One failed server doesn't break everything
- Automatic retries with smart backoff
- Graceful handling of network issues

### 📊 Full Visibility

- Real-time status of all servers
- Detailed error messages when things fail
- Progress tracking for long connections

## Enabling Async Loading

Async loading is an opt-in feature that's disabled by default to maintain backward compatibility.

### CLI Flag

```bash
# Enable async loading with CLI flag
npx -y @1mcp/agent --config mcp.json --enable-async-loading
```

### Environment Variable

```bash
# Enable via environment variable
export ONE_MCP_ENABLE_ASYNC_LOADING=true
npx -y @1mcp/agent --config mcp.json
```

### Real-Time Notifications

When async loading is enabled, clients receive `listChanged` notifications as servers become ready:

```mermaid
sequenceDiagram
    participant Client
    participant 1MCP
    participant Server1
    participant Server2

    Client->>1MCP: Connect
    1MCP-->>Client: Immediate connection (empty capabilities)

    par Background Loading
        1MCP->>Server1: Start server
        Server1-->>1MCP: Ready with tools
        1MCP-->>Client: listChanged notification (tools)
    and
        1MCP->>Server2: Start server
        Server2-->>1MCP: Ready with resources
        1MCP-->>Client: listChanged notification (resources)
    end
```

**Benefits:**

- **Progressive Discovery**: New capabilities appear in real-time
- **Batched Notifications**: Multiple changes grouped to prevent spam
- **Better UX**: No need to manually refresh or reconnect

## Configuration

You can customize the async loading behavior, such as timeouts and retry logic, in the `loading` section of your JSON configuration file.

For a complete list of options, see the **[Configuration Deep Dive](/guide/essentials/configuration#loading-section-async-loading)**.

## Health Check API

Check the status of your MCP servers through simple HTTP endpoints.

### Overall Status: `/health/mcp`

Get a complete overview of all your servers:

```bash
curl http://localhost:3000/health/mcp
```

**Example Response:**

```json
{
  "loading": {
    "isComplete": false, // Still connecting to some servers
    "successRate": 66.7, // 2 out of 3 servers connected
    "averageLoadTime": 2500 // Average connection time in ms
  },
  "summary": {
    "total": 3, // Total configured servers
    "ready": 2, // Servers ready to use
    "loading": 1, // Servers still connecting
    "failed": 0 // Servers that failed
  },
  "servers": {
    "ready": ["context7", "magic"], // Working servers
    "loading": ["sequential"] // Still connecting
  }
}
```

### Individual Server: `/health/mcp/:serverName`

Check a specific server:

```bash
curl http://localhost:3000/health/mcp/context7
```

**Example Response:**

```json
{
  "name": "context7",
  "state": "ready", // Current status
  "duration": 2300, // Time to connect (ms)
  "retryCount": 1, // Number of connection attempts
  "message": "Successfully connected"
}
```

## Common Scenarios

### Network Timeout

When a server takes too long to connect:

```
Server "context7" → Loading → Timeout (30s) → Failed → Retry in background (60s)
```

### OAuth Authorization

Some servers need you to authorize first:

```
Server "github" → Loading → Awaiting OAuth → Visit auth URL → Ready
```

### Partial Availability

When some servers work and others don't:

```
3 servers configured:
✅ context7 (ready)
✅ magic (ready)
❌ sequential (failed)

Result: 1MCP works with 2/3 servers, keeps retrying the failed one
```

## What You'll Notice

### Faster Startup ⚡

- 1MCP starts in under 1 second
- No more waiting for slow connections
- You can start working immediately

### Better Reliability 🛡️

- Individual server failures don't break everything
- Failed servers retry automatically in the background
- Clear visibility into what's working and what's not

### Monitoring Made Easy 📊

- Check `/health/mcp` anytime to see status
- Get detailed info about individual servers
- Real-time progress as servers connect

## Troubleshooting

### "Some servers are still loading"

**Normal behavior.** 1MCP starts fast and connects servers in background. Check `/health/mcp` to see progress.

### "Server keeps failing to connect"

1. Check your network connection
2. Verify server configuration in your `mcp.json`
3. Check if the server requires OAuth authorization
4. Look at `/health/mcp/servername` for detailed error messages

### "Everything seems slow"

1. Check how many servers you're loading simultaneously (`maxConcurrentLoads`)
2. Consider increasing timeout values for slow networks
3. Some servers might be rate-limiting your connections

### "1MCP won't start at all"

This usually means a configuration problem, not a server connection issue:

1. Check your `mcp.json` file syntax
2. Verify file permissions
3. Check the 1MCP logs for specific errors

::: tip
The async loading only affects MCP server connections. If 1MCP itself won't start, it's likely a configuration or permission issue.
:::
