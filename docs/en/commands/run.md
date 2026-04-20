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
npx -y @1mcp/agent run <server>/<tool> [options]
```

## Description

The `run` command is the execution step in the CLI workflow:

1. Run [`instructions`](./instructions.md) to see the playbook and available servers
2. Run [`inspect`](./inspect.md) to list tools and inspect tool schemas
3. Run `run` to invoke the selected tool

`run` talks to a running `1mcp serve` instance, forwards preset and tag filters, and prints tool output to stdout. Errors are written to stderr only so the command stays pipe-friendly.

`run` is intentionally the last step. The recommended flow is to discover broadly with `instructions`, narrow with `inspect`, confirm the exact tool schema with `inspect <server>/<tool>`, and only then invoke the tool.

## Options

### Target and Discovery

- **`<server>/<tool>`** - Tool reference in qualified form
- **`--url, -u <url>`** - Override auto-detected 1MCP server URL
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
- **`--cli-session-cache-path <path>`** - Override the session cache path template used by `run` and `inspect`

## Examples

### Explicit JSON Arguments

```bash
npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
```

### Pipe Raw Stdin into a Required String Argument

```bash
npx -y @1mcp/agent run summarizer/summarize < README.md
```

### Use a Preset

```bash
npx -y @1mcp/agent run --preset development validator/validate --args '{"path":"./schema.json"}'
```

### Use Script-Friendly JSON Output

```bash
npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}' --format json
```

### Use a Custom Session Cache Path

```bash
ONE_MCP_CLI_SESSION_CACHE_PATH=/tmp/1mcp/.cli-session.{pid} \
  npx -y @1mcp/agent run filesystem/read_file --args '{"path":"./README.md"}'
```

## Output Behavior

- Successful tool output is written to stdout
- Transport, validation, and invocation errors are written to stderr
- Tool-level errors set a non-zero exit code
- `compact` output respects `--max-chars`

The combination of stdout-only success output and compact formatting makes `run` practical for agent loops, shell automation, and post-processing with other CLI tools.

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Why execution comes last in the CLI workflow
- **[Instructions Command](./instructions.md)** - Start the CLI workflow with the current server inventory
- **[Inspect Command](./inspect.md)** - Inspect servers, tools, and schemas before calling a tool
- **[Serve Command](./serve.md)** - Start the 1MCP server that `run` talks to
- **[Configuration Deep Dive](../guide/essentials/configuration.md)** - Global flags including CLI session cache configuration
