---
title: Auth Command - Manage Authentication Profiles
description: Use the auth command to save, check, and remove bearer tokens for secured 1MCP serve instances.
head:
  - ['meta', { name: 'keywords', content: '1MCP auth command,authentication,bearer token,login,logout' }]
  - ['meta', { property: 'og:title', content: '1MCP Auth Command Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Save, check, and remove authentication profiles for secured 1MCP serve instances.',
      },
    ]
---

# Auth Command

Manage authentication profiles for named Runtime Target Contexts.

## Synopsis

```bash
npx -y @1mcp/agent auth <subcommand> [options]
```

## Subcommands

- **`login`** - Save a bearer token for a Runtime Target Context
- **`status`** - Show the saved authentication profile for a Runtime Target Context
- **`logout`** - Remove a saved authentication profile for a Runtime Target Context

---

## auth login

Save a bearer token so that `inspect`, `run`, and `instructions` can authenticate automatically.

```bash
npx -y @1mcp/agent auth login [options]
```

### How token resolution works

1. `--token` flag (explicit)
2. Stdin pipe (`echo $TOKEN | npx -y @1mcp/agent auth login --context <name>`)
3. Auto-generated CLI token for localhost servers (when the server supports it)

If the server has auth disabled, `login` exits early with a message — no token is stored.

### Options

- **`--context <name>`** - Runtime Target Context name. Required.
- **`--url, -u <url>`** - Unsupported for auth credential commands; use `target add <name> <url>` and then `--context <name>`.
- **`--token, -t <token>`** - Bearer token to save

### Examples

```bash
# Save token for the local runtime context
npx -y @1mcp/agent auth login --context local --token mytoken

# Pipe token from a secret manager
op read "op://vault/1mcp/token" | npx -y @1mcp/agent auth login --context prod

# Save token for a named remote target
npx -y @1mcp/agent target add prod https://1mcp.example.com
npx -y @1mcp/agent auth login --context prod --token mytoken
```

---

## auth status

Show saved authentication profiles and verify connectivity.

```bash
npx -y @1mcp/agent auth status [options]
```

`status` requires an explicit Runtime Target Context and checks only that context's scoped token.

### Options

- **`--context <name>`** - Runtime Target Context name. Required.
- **`--url, -u <url>`** - Unsupported for auth credential commands.

### Examples

```bash
# Check the local runtime context
npx -y @1mcp/agent auth status --context local

# Check a named remote target
npx -y @1mcp/agent auth status --context prod
```

---

## auth logout

Remove a saved authentication profile.

```bash
npx -y @1mcp/agent auth logout [options]
```

`logout` requires an explicit Runtime Target Context and clears only the token for the observed runtime identity.

### Options

- **`--context <name>`** - Runtime Target Context name. Required.
- **`--url, -u <url>`** - Unsupported for auth credential commands.
- **`--all`** - Unsupported for Runtime Target Context credentials.

### Examples

```bash
# Remove the local runtime context profile
npx -y @1mcp/agent auth logout --context local

# Remove a named remote target profile
npx -y @1mcp/agent auth logout --context prod
```

---

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Overview of the CLI workflow
- **[Instructions Command](./instructions.md)** - Start the CLI playbook
- **[Inspect Command](./inspect.md)** - Discover tools from a running server
- **[Run Command](./run.md)** - Execute a tool call
