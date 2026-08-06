---
title: Admin Commands
description: Manage CLI Admin sessions for Runtime Target Contexts.
---

# Admin Commands

`admin` manages Admin accounts and CLI Admin sessions for named Runtime Target Contexts. Credential commands require `--context`; `--url` is not supported for Admin credentials.

```bash
1mcp admin <subcommand> [options]
```

## bootstrap

```bash
1mcp admin bootstrap [--username <name>] [--password <password>] [--json]
```

Create the first Admin Account for the selected local Runtime Scope. `--json` defaults to `false`.

## login

```bash
1mcp admin login --context <name> [--username <name>] [--password <password>] [--json]
```

Create a CLI Admin session for a named context. `--json` defaults to `false`.

## status

```bash
1mcp admin status --context <name> [--json]
```

Show the saved Admin session status. `--json` defaults to `false`.

## logout

```bash
1mcp admin logout --context <name> [--forget] [--json]
1mcp admin logout --context local --all-local [--json]
```

Revoke a CLI Admin session. `--forget` clears only the local session reference without confirming remote revocation. `--all-local` clears every local Admin session reference and requires `--context local`. All three flags default to `false`.

## Example

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp admin login --context prod --username operator
1mcp admin status --context prod
```

See [Runtime Target Context Commands](/commands/target).
