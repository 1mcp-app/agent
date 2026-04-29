# 1MCP Docs Maintenance Guide

This directory contains the VitePress documentation site for 1MCP. Keep the current file structure and public paths stable. Improve content quality through clearer page roles, better routing between pages, and tighter bilingual parity rather than by moving pages around.

## What Lives Here

```text
docs/
├── .vitepress/          # VitePress config and locale navigation
├── en/                  # English content, served from the root path
├── zh/                  # Chinese content, served from /zh/
├── public/              # Static assets
├── CLAUDE.md            # Agent-facing docs editing rules
└── README.md            # This maintainer guide
```

The docs site is already split into a useful SEO-friendly shape:

- `index.md` pages position the product and route readers.
- `guide/` pages teach or help readers complete tasks.
- `commands/` pages document CLI behavior precisely.
- `reference/` pages explain exact system behavior, constraints, and architecture.

Keep that shape. Do not rename, move, or merge pages unless the change is explicitly requested.

## Local Development

```bash
pnpm install
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

Before finishing any docs change, run `pnpm docs:build`.

## Core Writing Model

The site should follow a simple rule: one page should answer one primary reader question.

Use these content types consistently:

- Home or entry pages: explain what 1MCP is and route readers to the right next page.
- Quick start pages: get the reader to a successful first result as fast as possible.
- Guide pages: explain concepts or help readers complete a task.
- Command pages: document syntax, options, examples, and related commands.
- Reference pages: provide exact lookup material, architecture detail, or behavioral constraints.

Avoid writing “mega pages” that try to be tutorial, operator guide, troubleshooting index, and reference all at once.

## Author Workflow

When editing or adding docs:

1. Decide the page type before writing.
2. Keep the existing file path and locale structure unless there is an explicit migration request.
3. Add or update frontmatter with a clear title and description.
4. Use absolute internal links such as `/guide/quick-start` and `/zh/guide/quick-start`.
5. Update both English and Chinese versions for any user-facing page you touch.
6. Update `.vitepress/config/en.ts` or `.vitepress/config/zh.ts` only if navigation truly needs to change.
7. Run `pnpm docs:build` before closing the work.

## Page-Level Standards

### Home and entry pages

- Keep them thin.
- Explain the product briefly.
- Route readers by intent such as quick start, CLI mode, direct MCP, or reference.
- Do not duplicate full setup or full architecture content here.

### Quick start pages

- Optimize for the shortest successful path.
- Include prerequisites, exact steps, expected outcomes, and next steps.
- Provide the smallest useful troubleshooting section.
- Move deep explanation to existing guide or reference pages.

### Guide pages

- Focus on one learning path, workflow, or conceptual topic.
- Explain when to use the path and when not to use it.
- Link out to command and reference pages instead of duplicating exact option tables.

### Command pages

- Prioritize exact syntax, option semantics, examples, and related commands.
- Keep tutorial framing light.
- Use examples that can be copied and run with minimal edits.

### Reference pages

- Keep the tone precise and stable.
- Prefer definitions, behavior, constraints, diagrams, and interface details.
- Do not turn reference into onboarding content.

## Bilingual Rules

- English and Chinese public pages should stay aligned in structure, scope, and intent.
- Translation does not need to be literal, but both locales should guide the reader through the same workflow.
- If a page is materially rewritten in one locale, update the paired locale in the same change.

## Quality Bar

Every user-facing docs change should aim for:

- Copy-pasteable commands
- Version-aware examples where version matters
- Clear success criteria for setup flows
- Clear routing to deeper pages instead of duplicate explanations
- Consistent terminology across `en` and `zh`
- Working internal links

## Technical Notes

- English content is served from root paths; Chinese content is served from `/zh/`.
- Locale navigation lives in `.vitepress/config/en.ts` and `.vitepress/config/zh.ts`.
- Static assets belong in `docs/public/images/`.
- VitePress uses Vue rendering. If you need literal <span v-pre>`{{ }}`</span> template syntax, follow the escaping rules in [CLAUDE.md](/CLAUDE).

## Deployment

- Primary site: `https://docs.1mcp.app/`
- GitHub Pages mirror: `https://1mcp-app.github.io/agent/`
- Workflow: `.github/workflows/deploy-documentation.yml`

The site is built from the existing docs tree. Preserve path stability unless there is a deliberate migration plan.
