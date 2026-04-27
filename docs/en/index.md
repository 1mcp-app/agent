---
layout: home
title: '1MCP Agent - Unified MCP Runtime and CLI Mode for Agents'
description: 'Run one aggregated MCP runtime with 1MCP and give Codex, Claude, and other agents a thinner CLI workflow on top.'
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: '1MCP,MCP runtime,CLI mode,agent workflow,Codex,Claude,template servers,async loading,lazy loading',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Agent - Unified MCP Runtime' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Aggregate many MCP servers behind 1mcp serve and use CLI mode for progressive discovery in agent sessions.',
      },
    ]
  - ['meta', { name: 'twitter:title', content: '1MCP Agent - Unified MCP Runtime' }]
  - [
      'meta',
      {
        name: 'twitter:description',
        content: 'Unified MCP runtime plus agent-friendly CLI mode for Codex, Claude, and direct MCP clients.',
      },
    ]

hero:
  name: '1MCP Agent'
  text: 'One runtime for MCP, one thinner workflow for agents'
  tagline: 'Run your MCP servers behind `1mcp serve`, then let agents use CLI mode for progressive discovery instead of carrying the full tool surface in context.'
  image:
    src: /images/logo.png
    alt: 1MCP Agent Logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: CLI Mode
      link: /guide/integrations/cli-mode
    - theme: alt
      text: Architecture
      link: /reference/architecture

features:
  - icon: 🧭
    title: Progressive CLI Discovery
    details: 'Agents start with `instructions`, narrow with `inspect`, and only run the tool they actually need.'
  - icon: 🧩
    title: Unified Runtime
    details: '`1mcp serve` aggregates static and template-backed MCP servers behind one runtime.'
  - icon: 🪄
    title: Context-Aware Templates
    details: Template servers can be created per client or session instead of being fixed at startup.
  - icon: ⚡
    title: Async and Lazy Loading
    details: Start faster, load in the background, and expose less until a client or agent actually needs it.
  - icon: 📦
    title: Presets and Filters
    details: Reuse server sets across projects, clients, and compatibility bridges without duplicating config.
  - icon: 🔐
    title: Direct HTTP and Compatibility Paths
    details: 'Support direct HTTP MCP attachment and `proxy` for stdio-only clients without making either the only story.'
---

## Why 1MCP?

1MCP solves two related problems at once:

- **Configuration sprawl**: too many clients each need their own MCP setup.
- **Agent context sprawl**: too many tools and schemas get injected into long-running agent loops.

The current product model is:

- `1mcp serve` is the unified runtime.
- CLI mode is the preferred agent-facing workflow on top of that runtime.
- Direct MCP attachment remains supported for MCP-native clients.

## Quick Start

```bash
npm install -g @1mcp/agent
1mcp mcp add context7 -- npx -y @upstash/context7-mcp
1mcp serve
```

Prefer CLI mode for agents:

```bash
1mcp cli-setup --codex
# or
1mcp cli-setup --claude --scope repo --repo-root .
```

Then the agent workflow becomes:

```bash
1mcp instructions
1mcp inspect context7
1mcp inspect context7/get-library-docs
1mcp run context7/get-library-docs --args '{"context7CompatibleLibraryID":"/mongodb/docs","topic":"aggregation pipeline"}'
```

## Benefits

- **Smaller working surface for agents**: progressive discovery avoids dumping the whole tool catalog into context.
- **One runtime for many clients**: agents, direct HTTP MCP clients, and stdio-only compatibility flows can share the same backend inventory.
- **Current runtime behavior, not a static proxy model**: async loading, lazy loading, templates, instructions, and presets are part of the main system design.

## Pick Your Path

<div class="vp-feature-grid">
  <a href="/guide/integrations/cli-mode" class="vp-feature-box">
    <h3>CLI Mode for Agents</h3>
    <p>Best for Codex, Claude, and similar agent loops that benefit from progressive discovery.</p>
  </a>

  <a href="/commands/serve" class="vp-feature-box">
    <h3>Direct Runtime Usage</h3>
    <p>Best for MCP-native HTTP clients that want to connect straight to the aggregated runtime.</p>
  </a>

  <a href="/commands/proxy" class="vp-feature-box">
    <h3>stdio Compatibility</h3>
    <p>Use `proxy` only when a client cannot talk to the HTTP runtime directly.</p>
  </a>
</div>

<style>
.vp-feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
  margin-top: 2rem;
}

.vp-feature-box {
  padding: 1.5rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  text-decoration: none;
  transition: border-color 0.25s;
}

.vp-feature-box:hover {
  border-color: var(--vp-c-brand);
}

.vp-feature-box h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
}

.vp-feature-box p {
  margin: 0;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}
</style>
