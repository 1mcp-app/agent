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

Client hooks run `bootstrap` to establish ownership and fetch guidance through `instructions`. Agents run `instructions` separately only when current guidance is missing or needs refreshing; it does not create an owner credential. See [the startup workflow](/guide/worktrees-and-cross-project-sessions#bootstrap-and-instructions-which-one-runs).

Show CLI-mode instructions for AI agents using a running 1MCP `serve` instance.

Reuse known tool schemas within the session, including across projects, when the tool contract is unchanged. Keep project-specific instructions, readiness, authorization, and target selection current. Refresh server and tool inspection when information is missing, capabilities change, preparation completes, or relevant failures occur. Never automatically replay failed tool calls.

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

In practice, `instructions` is what replaces a large direct-MCP starting surface in the agent loop. Instead of expecting the agent to carry every available tool and schema up front, 1MCP gives it a compact playbook plus the current inventory, then tells it to narrow further with `inspect`.

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
- **`--context <name>`** - Use a named Runtime Target Context and its saved bearer token, if any
- **`--preset, -p <name>`** - Use a preset when querying the running server
- **`--tag-filter, -f <expression>`** - Apply an advanced tag filter expression
- **`--tags <tag>`** - Apply simple comma-separated tags

### Project selection and ownership

- **`--project <path-or-label>`** — Select a checkout or a project-set member.
- **`--project-set <file>`** — Load a saved project set.
- **`--project-owner <file>`** — Override automatic owner lookup with this caller’s own bootstrap credential when required.

See [Project and owner options](/guide/project-checkouts#project-and-owner-options) for shared rules. Supported Codex sessions use their verified owner and assigned project automatically. Claude and hosts without automatic owner lookup must supply their own bootstrap `--project-owner <own-file>`. Keep explicit target overrides consistent across related calls.

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

### Use a Runtime Target Context

```bash
1mcp instructions --context prod
```

## Recommended Workflow

After reading applicable instructions, inspect only when information is missing or needs refreshing, capabilities change, preparation completes, or relevant failures occur. Then invoke using the known schema:

```bash
# When server inventory or instructions are missing or need refreshing:
1mcp inspect <server>
# When the tool schema is missing or needs refreshing:
1mcp inspect <server>/<tool>
# Invoke using current instructions and the known schema:
1mcp run <server>/<tool> --args '<json>'
```

If authentication is required, the playbook directs the user or agent to retry with:

```bash
1mcp auth login --context <name> --token <token>
```

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Why this progressive-disclosure workflow exists
- **[Inspect Command](./inspect.md)** - Discover tools and inspect schemas
- **[Run Command](./run.md)** - Call a selected tool
- **[CLI Setup Command](./cli-setup.md)** - Install startup hooks and bootstrap docs for Codex or Claude
- **[Serve Command](./serve.md)** - Start the 1MCP server that provides the instruction output
