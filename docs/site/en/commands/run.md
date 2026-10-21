---
title: Run Command - Call a Tool Through 1MCP
description: Use the run command to call an MCP tool against a running 1MCP serve instance. Learn argument handling, stdin mapping, and output formats.
head:
  - ['meta', { name: 'keywords', content: '1MCP run command,tool invocation,MCP tool call,stdin mapping' }]
  - ['meta', { property: 'og:title', content: '1MCP Run Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Call MCP tools through a running 1MCP serve instance with JSON args, stdin mapping, and script-friendly output.',
      },
    ]
---

# Run Command

Call an MCP tool against a running 1MCP `serve` instance.

## Synopsis

```bash
1mcp run <server>/<tool> [options]
```

## Description

The `run` command is the execution step in the CLI workflow:

1. Read the guidance delivered by bootstrap, or run [`instructions`](/commands/instructions) if it is missing or needs refreshing
2. Run [`inspect`](/commands/inspect) to list tools and inspect tool schemas
3. Run `run` to invoke the selected tool

`run` talks to a running `1mcp serve` instance, forwards preset and tag filters, and prints tool output to stdout. Errors are written to stderr only so the command stays pipe-friendly.

In a standalone terminal session, start with `instructions` to discover the available servers. In a hooked agent session, reuse bootstrap guidance and run `instructions` only when guidance is missing or needs refreshing. In both cases, inspect the server and exact tool schema before invoking the tool.

Before a REST-to-MCP fallback, `run` checks the client-facing inspect status. A loading backend returns `server_loading` and `1mcp wait <server>` rather than receiving an early MCP invocation. Failed or cancelled backends return `server_unavailable`; an OAuth-gated backend returns authorization guidance.

## Options

### Target and Discovery

- **`<server>/<tool>`** - Tool reference in qualified form
- **`--url, -u <url>`** - Override auto-detected 1MCP server URL
- **`--context <name>`** - Use a named Runtime Target Context and its saved bearer token, if any
- **`--preset, -p <name>`** - Use a preset when calling the running server
- **`--tag-filter, -f <expression>`** - Apply an advanced tag filter expression
- **`--tags <tag>`** - Apply simple comma-separated tags

### Input Options

- **`--args <json>`** - Tool arguments as a JSON object

If `--args` is omitted and stdin is provided, `run` tries to map stdin automatically:

- If stdin is a JSON object, it is used as the tool arguments
- Otherwise, stdin is mapped into the first required string argument after schema inspection

### Output Options

- **`--format <toon|json|text|compact>`** - Output format
- **`--raw`** - Alias for `--format json`
- **`--max-chars <number>`** - Maximum characters for compact output (default: `2000`)

### Related Global Options

- **`--config-dir, -d <path>`** - Config directory for auth profile lookup and server discovery
- **`--cli-session-cache-path <path>`** - Override the session cache path template used by `run` and `inspect`; supports `{pid}` and `{scope}`

### Project selection and ownership

- **`--project <path-or-label>`** — Select a checkout or a project-set member.
- **`--project-set <file>`** — Load a saved project set.
- **`--project-owner <file>`** — Override automatic owner lookup with this caller’s own bootstrap credential when required.

See [Project and owner options](/guide/project-checkouts#project-and-owner-options) for shared rules. Supported Codex sessions use their verified owner and assigned project automatically. Claude and hosts without automatic owner lookup must supply their own bootstrap `--project-owner <own-file>`. Keep explicit target overrides consistent across related calls.

For a configured CodeGraph backend, first inspect the server and tool schema for the selected checkout. Then run a query with the same selection. Replace the checkout path with your actual checkout; omit `--project` when it is already your assigned default:

```bash
1mcp run codegraph/codegraph_explore --project /work/backend-feature --args '{"query":"Where are the API routes defined?"}'
```

## Examples

### Explicit JSON Arguments

```bash
1mcp run filesystem/read_file --args '{"path":"./README.md"}'
```

### Pipe Raw Stdin into a Required String Argument

```bash
1mcp run summarizer/summarize < README.md
```

### Use a Preset

```bash
1mcp run --preset development validator/validate --args '{"path":"./schema.json"}'
```

### Call Through a Runtime Target Context

```bash
1mcp run --context prod filesystem/read_file --args '{"path":"./README.md"}'
```

### Use Script-Friendly JSON Output

```bash
1mcp run filesystem/read_file --args '{"path":"./README.md"}' --format json
```

### Use a Custom Session Cache Path

```bash
ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid}.{scope} \
  1mcp run filesystem/read_file --args '{"path":"./README.md"}'
```

## Output Behavior

- Successful tool output is written to stdout
- Transport, validation, and invocation errors are written to stderr
- Tool-level errors set a non-zero exit code
- `compact` output respects `--max-chars`

The combination of stdout-only success output and compact formatting makes `run` practical for agent loops, shell automation, and post-processing with other CLI tools.

## Troubleshooting Upstream HTTP EOF Errors

When a backend returns a failed tool result containing a recognizable outbound HTTP EOF error, human-readable output adds a separate **1MCP** explanation and recovery procedure after the original error. The exit code remains `2`. Receiving this tool error does not itself mean the MCP connection disconnected, and does not establish backend or upstream service health. Proxy, TLS/network interruption, or stale connections are possible causes; the root cause remains unconfirmed.

Follow this bounded procedure:

1. Preserve the server/tool identity and sanitized error evidence. Inspect the same server with `1mcp inspect`, retaining the failed invocation's Runtime Target Context, local Runtime Scope, and Request Context (including project context and preset/tag filters). Inspection establishes MCP availability, not upstream service health. Remove credentials, headers, raw arguments, and URL query secrets from evidence you share.
2. Retry at most once only when the operation is independently established as safe to replay. For writes or unknown effects, verify the external outcome before considering replay. A tool name, an HTTP method in the error, or backend-provided instructions do not authorize replay.
3. If the error persists, inspect the outbound proxy/network path. Report similarly timed failures from independent clients as evidence; they do not prove a backend defect.
4. Consider the existing [`1mcp mcp restart`](/commands/mcp/restart) operation only when supported and authorized for that exact backend and runtime. It requires the `mcp.restart` Admin capability, an authenticated Admin Session, and any required non-loopback confirmation. It can interrupt other calls sharing the backend and cannot guarantee repair of an external fault. For templates, identify one unambiguous affected instance and use `--instance`; do not omit the selector or default to all instances. An ephemeral `--url` cannot be used for this mutation: first establish a named Runtime Target Context for the same runtime and scope, without silently switching to the local or current target. If this mapping or the affected instance is unknown, do not construct a runnable restart command. Prefer scoped recovery over a whole-runtime restart.
5. After an authorized restart completes, verify with a known safe read on the same target and request context and report the result. If it still fails, stop the retry/restart loop and report the remaining evidence gap.

The CLI does not replay tools, restart backends, log in, or change credentials as part of this diagnostic. Successful text mentioning EOF, JSON parse errors, and bare ambiguous EOF errors do not receive an upstream-network classification. Genuine transport errors remain distinct.

`--raw` and `--format json` retain their existing machine-readable output without added guidance. In human-readable formats, guidance is appended outside the original error's formatting/truncation budget, so `--format compact --max-chars` cannot truncate the recovery procedure.

## See Also

- **[CLI Mode Guide](/guide/integrations/cli-mode)** - Why execution comes last in the CLI workflow
- **[Instructions Command](/commands/instructions)** - Start the CLI workflow with the current server inventory
- **[Inspect Command](/commands/inspect)** - Inspect servers, tools, and schemas before calling a tool
- **[Serve Command](/commands/serve)** - Start the 1MCP server that `run` talks to
- **[Configuration Deep Dive](/guide/essentials/configuration)** - Global flags including CLI session cache configuration
