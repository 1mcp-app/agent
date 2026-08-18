---
title: Getting Started with 1MCP
description: Choose a supported 1MCP onboarding path, install a runtime, verify a first run, and continue to the canonical configuration, authentication, or deployment guide.
head:
  - [
      'meta',
      { name: 'keywords', content: '1MCP getting started,installation,first run,CLI mode,OAuth 2.1,configuration' },
    ]
  - ['meta', { property: 'og:title', content: 'Getting Started with 1MCP' }]
  - [
      'meta',
      { property: 'og:description', content: 'Choose a supported 1MCP onboarding path and verify your first runtime.' },
    ]
---

# Getting Started with 1MCP

Use this page to choose and stage an onboarding path. It preserves one small first run, then sends you to the canonical guide for installation, configuration, authentication, or deployment details.

If you want the shortest agent-focused path, start with [Quick Start](/guide/quick-start).

## Choose Your Path

- **Agent CLI mode**: [Quick Start](/guide/quick-start) for `serve`, `cli-setup`, and progressive discovery.
- **Direct runtime**: [Configuration](/guide/essentials/configuration) and the [serve command](/commands/serve) for an HTTP runtime.
- **Maximum compatibility**: the [Proxy command](/commands/proxy) for stdio clients that need project context.
- **Protected runtime**: [Authentication](/guide/advanced/authentication) for OAuth 2.1 and scope configuration.
- **Shared or public deployment**: [Cloud Deployment with Caddy](/guide/advanced/cloud-deployment).
- **Persistent Windows deployment**: [Windows Task Scheduler](/guide/advanced/windows-task-scheduler) for boot startup, restart-on-failure, and non-interactive supervision.

## Prerequisites

- Linux, macOS, or Windows
- A terminal and a writable configuration directory
- Node.js `^20.19.0 || ^22.12.0 || >=23.0.0` for npm installs

Standalone release archives do not require a local Node.js installation. Contributors and source installs should use the version in `.node-version`; it is the repository default, not a published package support contract.

## Stage 1: Install a Runtime

Choose one installation method. The [Installation guide](/guide/installation) is the canonical source for every platform and Docker option.

### Release Archive

Releases publish archives, not raw executable downloads. Use the archive for your platform, extract it, then run the extracted binary:

```bash
# Linux x64
curl -LO https://github.com/1mcp-app/agent/releases/latest/download/1mcp-linux-x64.tar.gz
tar -xzf 1mcp-linux-x64.tar.gz
sudo install -m 0755 1mcp-linux-x64 /usr/local/bin/1mcp
1mcp --version

# macOS Apple Silicon
curl -LO https://github.com/1mcp-app/agent/releases/latest/download/1mcp-darwin-arm64.tar.gz
tar -xzf 1mcp-darwin-arm64.tar.gz
sudo install -m 0755 1mcp-darwin-arm64 /usr/local/bin/1mcp
1mcp --version
```

```powershell
# Windows x64
Invoke-WebRequest -Uri "https://github.com/1mcp-app/agent/releases/latest/download/1mcp-win32-x64.zip" -OutFile "1mcp-win32-x64.zip"
Expand-Archive -Path "1mcp-win32-x64.zip" -DestinationPath "."
.\1mcp-win32-x64.exe --version
```

The remaining published archives are `1mcp-linux-arm64.tar.gz` and `1mcp-darwin-x64.tar.gz`. See [Installation](/guide/installation) for their exact commands, npm, and Docker.

### npm

With a supported Node.js runtime, you can install globally:

```bash
npm install -g @1mcp/agent
1mcp --version
```

## Stage 2: Prove a First Runtime

Add one upstream MCP server and start the runtime:

```bash
1mcp mcp add context7 -- npx -y @upstash/context7-mcp
1mcp serve
```

Keep `serve` running. In another shell, confirm the runtime can describe its connected server:

```bash
1mcp inspect context7
```

Continue with [Configuration](/guide/essentials/configuration) for configuration-file locations, selectors, environment variables, and runtime options. Use [Quick Start](/guide/quick-start) to connect an agent through CLI mode.

## Stage 3: Connect a Client

For Codex or Claude, run the agent path from [Quick Start](/guide/quick-start):

```bash
1mcp cli-setup --codex
```

For Codex, `cli-setup` prints required `config.toml` changes but does not apply them. Add the printed snippet before opening the next Codex session, then verify `instructions -> inspect -> run`.

For a non-CLI stdio client, use [Proxy](/commands/proxy). For an MCP-native HTTP client that does not need project context, use [serve](/commands/serve).

## Stage 4: Add Authentication When Needed

Do this only after the basic runtime works. 1MCP supports dynamic client registration (DCR) followed by an authorization-code flow with PKCE. Use a client or tested tool that supports that browser-mediated flow; do not use a client-credentials grant or invent a client secret.

Follow the [Authentication guide](/guide/advanced/authentication) for enabling the runtime, registering a client through DCR, authorization, scopes, and troubleshooting.

## Stage 5: Deploy Deliberately

For a shared or public runtime, move to [Cloud Deployment with Caddy](/guide/advanced/cloud-deployment). It covers the public HTTPS origin, proxy trust, Admin Console, and local CLI target setup that a production deployment requires.

On Windows, use [Windows Task Scheduler](/guide/advanced/windows-task-scheduler) to supervise a foreground `1mcp serve` process across reboots. The guide covers standalone binary and npm paths, credential handling, lifecycle commands, and troubleshooting.

## First-Run Checklist

- `1mcp --version` succeeds using the selected installation method
- `1mcp serve` stays running
- `1mcp inspect <server>` reports the configured upstream server
- Your next guide matches the path you selected: CLI mode, configuration, authentication, proxy, cloud deployment, or Windows Task Scheduler
