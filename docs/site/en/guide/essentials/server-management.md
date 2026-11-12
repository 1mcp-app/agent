---
title: Manage Backend Servers
description: Choose a setup method, verify readiness, and maintain backend configuration.
---

# Manage Backend Servers

Choose the setup path that matches your backend, then verify the running runtime separately from the saved configuration.

## Choose a setup method

| Starting point                                               | Command or guide                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| An installed CodeGraph, Code Review Graph, or Serena backend | [mcp setup](/commands/mcp/setup)                           |
| A server listed in a registry                                | [mcp install](/commands/mcp/install)                       |
| A known executable or remote MCP URL                         | [mcp add](/commands/mcp/add)                               |
| Existing desktop application configuration                   | [App consolidation](/guide/integrations/app-consolidation) |

### Registry setup

```bash
1mcp registry search filesystem --type=npm --transport=stdio
1mcp mcp install --interactive
```

Select an actual registry result. For noninteractive setup, preview `1mcp mcp install <registry-id> --dry-run` before applying it. Registry setup writes a backend definition; it does not certify the package or prove that required credentials and runtime dependencies are available. See [mcp install](/commands/mcp/install) for version-selection limits.

### Explicit launch command or URL

```bash
1mcp mcp add custom-server --type=stdio -- node /absolute/path/server.js
1mcp mcp add remote-api --type=http --url=https://mcp.example.com/mcp
```

Replace the example script or URL with your backend. STDIO launches a child process; HTTP connects to a separately hosted service. Legacy SSE is also supported, but use Streamable HTTP for new integrations when available.

Keep the executable and its arguments separate. Set a working directory when the backend needs one, and supply only the environment values it needs. See [MCP Servers](/reference/mcp-servers).

## Configure a Custom Server in the Admin Console

Use **Server inventory → Configure Custom Server** when you need to add a static server or Template Server definition without editing the runtime configuration file. The shared form supports local STDIO, remote HTTP, and legacy SSE targets.

1. Choose **Static** or **Template**, then complete the transport-specific structured fields. STDIO requires a command; HTTP and SSE require a URL.
2. Add tags. Static targets can start enabled or disabled; Template definitions expose lifecycle controls and accept Handlebars expressions in fields rendered by the runtime.
3. For credentials, prefer **Environment Secret Reference**. The configuration stores the environment variable name or substitution expression instead of the secret material. Inline secret replacement is an advanced fallback.
4. Select **Preview server**. Preview validates the target, reports name conflicts, and redacts secret material. Static remote targets run a bounded connectivity check when applicable; Template preview validates structure and Request Context variable names without rendering context, connecting a backend, or creating an instance.
5. Review the diff and runtime facts, then explicitly confirm the source-specific create action.

Creation never replaces an existing static or Template Server target. If another writer creates the same name after preview, the confirmation is rejected and you must preview again. After a successful write, the Admin Console refreshes the inventory and opens the created source-qualified target. Template definitions become eligible after reload and create instances only when a later matching request supplies Request Context.

## Verify readiness

```bash
1mcp mcp list
1mcp mcp status custom-server
1mcp inspect
```

`mcp list` confirms saved definitions. Review the mutation's reload result and use `inspect` against the intended runtime to check visible server state and capabilities. Configuration success alone does not establish backend connectivity, authentication, or tool success. Start the runtime with [serve](/commands/serve) if it is not running.

For project-aware backends, first follow [Project checkouts](/guide/project-checkouts); setup alone does not establish project context or preparation readiness.

## Maintain configuration

```bash
1mcp mcp update custom-server --tags=custom,development
1mcp mcp disable custom-server
1mcp mcp enable custom-server
1mcp mcp uninstall custom-server
```

Run only the action you intend. `update` edits configuration, `disable` retains the definition, and `uninstall` removes it with a backup by default. `uninstall` does not prompt for confirmation. Check its reported backup path and reload status. None of these commands is a package-manager upgrade operation.

## Operational practices

Use descriptive names and consistent tags, restrict backend permissions, and keep credentials in supported environment references. Set connection and request timeouts for each backend. Review [recovery](/guide/advanced/performance) and [backend logs](/guide/advanced/backend-logs) before diagnosing repeated failures.
