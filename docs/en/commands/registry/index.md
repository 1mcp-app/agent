---
title: Registry Commands
description: Reference for the 1MCP registry discovery commands.
---

# Registry Commands

Use `registry` to query the configured MCP registry. This command group has four subcommands: `search`, `status`, `show`, and `versions`.

```bash
1mcp registry <subcommand> [options]
```

## Shared Registry Options

All registry subcommands accept these transport options when needed:

- `--url <url>`: Registry base URL.
- `--timeout <ms>`: Registry request timeout.
- `--cache-ttl <seconds>`, `--cache-max-size <number>`, `--cache-cleanup-interval <ms>`: In-process cache settings.
- `--proxy <url>`, `--proxy-auth <username:password>`: HTTP proxy settings for registry requests.

## Commands

- [search](/commands/registry/search): find registry entries by text, status, package type, or transport.
- [status](/commands/registry/status): check registry availability and optional counts.
- [show](/commands/registry/show): inspect one registry entry.
- [versions](/commands/registry/versions): list versions for one registry entry.

## Typical Lookup

```bash
1mcp registry search filesystem --type npm --transport stdio
1mcp registry show io.github.containers/kubernetes-mcp-server
1mcp registry versions io.github.containers/kubernetes-mcp-server --format json
```

Use the exact registry ID returned by `search` with [mcp install](/commands/mcp/install). Registry configuration, login, private-registry management, cache-clearing, and update commands are not part of this command group.
