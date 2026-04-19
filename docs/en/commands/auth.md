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

Manage authentication profiles for secured 1MCP `serve` instances.

## Synopsis

```bash
npx -y @1mcp/agent auth <subcommand> [options]
```

## Subcommands

- **`login`** - Save a bearer token for a server URL
- **`status`** - Show saved authentication profiles
- **`logout`** - Remove a saved authentication profile

---

## auth login

Save a bearer token so that `inspect`, `run`, and `instructions` can authenticate automatically.

```bash
npx -y @1mcp/agent auth login [options]
```

### How token resolution works

1. `--token` flag (explicit)
2. Stdin pipe (`echo $TOKEN | npx -y @1mcp/agent auth login`)
3. Auto-generated CLI token for localhost servers (when the server supports it)

If the server has auth disabled, `login` exits early with a message — no token is stored.

### Options

- **`--url, -u <url>`** - 1MCP server URL (auto-detected from running server if omitted)
- **`--token, -t <token>`** - Bearer token to save

### Examples

```bash
# Auto-detect local server and save token from flag
npx -y @1mcp/agent auth login --token mytoken

# Pipe token from a secret manager
op read "op://vault/1mcp/token" | npx -y @1mcp/agent auth login

# Specify a remote server
npx -y @1mcp/agent auth login --url https://1mcp.example.com --token mytoken
```

---

## auth status

Show saved authentication profiles and verify connectivity.

```bash
npx -y @1mcp/agent auth status [options]
```

When `--url` is omitted, `status` auto-detects the running server and shows its profile. If no server is found, it lists all saved profiles.

### Options

- **`--url, -u <url>`** - Check a specific server URL

### Examples

```bash
# Check the auto-detected local server
npx -y @1mcp/agent auth status

# Check a specific server
npx -y @1mcp/agent auth status --url https://1mcp.example.com
```

---

## auth logout

Remove a saved authentication profile.

```bash
npx -y @1mcp/agent auth logout [options]
```

When neither `--url` nor `--all` is provided, `logout` auto-detects the running server and removes its profile.

### Options

- **`--url, -u <url>`** - Server URL whose profile to remove
- **`--all`** - Remove all saved profiles

### Examples

```bash
# Remove the auto-detected local server's profile
npx -y @1mcp/agent auth logout

# Remove a specific server's profile
npx -y @1mcp/agent auth logout --url https://1mcp.example.com

# Remove all saved profiles
npx -y @1mcp/agent auth logout --all
```

---

## See Also

- **[CLI Mode Guide](../guide/integrations/cli-mode.md)** - Overview of the CLI workflow
- **[Instructions Command](./instructions.md)** - Start the CLI playbook
- **[Inspect Command](./inspect.md)** - Discover tools from a running server
- **[Run Command](./run.md)** - Execute a tool call
