---
title: Wait Command - Wait for Static MCP Servers
description: Wait for configured static MCP servers to become connected before invoking tools.
---

# Wait Command

Wait for enabled configured static MCP servers to become connected through the authenticated `/api/v1/inspect` status contract.

```bash
npx -y @1mcp/agent wait [server] [options]
```

Without a server, `wait` covers all matching configured static servers. Templates and disabled servers are excluded. A template target returns `server_not_load_tracked`; an unknown target returns `server_not_found`.

## Options

- **`[server]`** - One configured static server to wait for
- **`--timeout <ms>`** - Positive timeout in milliseconds, default `30000`
- **`--url, -u <url>`** - Override the auto-detected runtime URL
- **`--context <name>`** - Use a named Runtime Target Context
- **`--preset`, `--tag-filter`, `--tags`** - Apply the same client-facing filters as `inspect`
- **`--format <toon|text|json>`** - Select success output format

## Behavior

Success requires every requested server to report `connected` and `available`. `failed`, `cancelled`, `awaiting_oauth`, and unavailable terminal states stop immediately with a structured nonzero error. A timeout includes the last observed states and a recovery command. Waiting never cancels background loading.

Use `wait` before `run` when a script must depend on a newly started backend. `run` also checks inspect status before its REST-to-MCP fallback and returns `server_loading` with the same recovery command when the backend is still loading.
