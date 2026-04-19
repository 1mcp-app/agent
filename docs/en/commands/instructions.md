---
title: Instructions Command - CLI Playbook for Agent Workflows
description: Use the instructions command to print the CLI playbook and current server inventory for AI agents using a running 1MCP serve instance.
head:
  - ['meta', { name: 'keywords', content: '1MCP instructions command,agent workflow,CLI playbook,server inventory' }]
  - ['meta', { property: 'og:title', content: '1MCP Instructions Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Print the CLI playbook and current server inventory for AI-agent workflows against a running 1MCP serve instance.',
      },
    ]
---

# Instructions Command

Show CLI-mode instructions for AI agents using a running 1MCP `serve` instance.

## Synopsis

```bash
npx -y @1mcp/agent instructions [options]
```

## Description

The `instructions` command is the entrypoint for CLI-mode agent workflows. It prints:

- A fixed playbook telling the agent to use `inspect` before `run`
- A server summary section
- A server details section
- Per-server instruction blocks when the server provides them

Use this command first when an agent or terminal session needs current guidance from the running 1MCP instance.

## Output Structure

The output is designed to be agent-readable and includes:

- `=== PLAYBOOK ===` - The required CLI workflow
- `=== SERVER SUMMARY ===` - One compact record per server
- `=== SERVER DETAILS ===` - Detailed records including instructions or availability notes

Each server entry includes metadata such as:

- Server name
- Server type
- Connection status
- Availability
- Tool count
- Whether instructions are available

## Options

- **`--url, -u <url>`** - Override auto-detected 1MCP server URL
- **`--preset, -p <name>`** - Use a preset when querying the running server
- **`--tag-filter, -f <expression>`** - Apply an advanced tag filter expression
- **`--tags <tag>`** - Apply simple comma-separated tags

## Examples

### Show the Full CLI Playbook

```bash
npx -y @1mcp/agent instructions
```

### Show Instructions for a Filtered Server Set

```bash
npx -y @1mcp/agent instructions --tags backend
```

### Use a Saved Preset

```bash
npx -y @1mcp/agent instructions --preset development
```

## Recommended Workflow

After reading `instructions`, continue with:

```bash
npx -y @1mcp/agent inspect <server>
npx -y @1mcp/agent inspect <server>/<tool>
npx -y @1mcp/agent run <server>/<tool> --args '<json>'
```

If authentication is required, the playbook directs the user or agent to retry with:

```bash
1mcp auth login --url <server-url> --token <token>
```

## See Also

- **[Inspect Command](./inspect.md)** - Discover tools and inspect schemas
- **[Run Command](./run.md)** - Call a selected tool
- **[CLI Setup Command](./cli-setup.md)** - Install startup hooks and bootstrap docs for Codex or Claude
- **[Serve Command](./serve.md)** - Start the 1MCP server that provides the instruction output
