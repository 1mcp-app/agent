---
title: CLAUDE
description: Documentation maintenance rules for the 1MCP VitePress site.
---

# CLAUDE.md

This file tells coding agents how to edit the `docs/` site in this repository.

## Mission

Improve the docs without breaking the existing public path structure.

Use the current site model:

- `index.md` pages are entrypoints.
- `guide/` teaches or helps complete tasks.
- `commands/` documents CLI behavior precisely.
- `reference/` is for exact lookup and architecture.

Do not turn one page into multiple content types at once.

## Non-Negotiables

- Keep the current `docs/en/**` and `docs/zh/**` file layout unless explicitly asked to restructure it.
- Preserve SEO-sensitive URLs.
- Update both locales for any user-facing page you materially change.
- Use absolute internal links.
- Run `pnpm docs:build` after docs edits.

## Docs-Specific Commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

## Content-Type Rules

### Home and landing pages

- Keep them short and directional.
- Explain what 1MCP is.
- Route readers to the correct next page.
- Do not paste a full tutorial into the homepage.

### Quick start

- Optimize for the fastest successful outcome.
- Include prerequisites, exact steps, expected output, and next steps.
- Keep conceptual depth light and push deep explanation elsewhere.

### Getting started and other guides

- Use them for path selection, task guidance, and concept framing.
- Split “what path should I take?” from “what exact flags does this command support?”
- Link to command and reference pages rather than duplicating them.

### Command docs

- Document syntax, option semantics, examples, and related commands.
- Prefer exactness over narrative.
- Keep examples realistic and copy-pasteable.

### Reference docs

- Use these for architecture, behavior, interfaces, and constraints.
- Avoid tutorial-style repetition.

## Bilingual Editing Rules

- English and Chinese pages should match in intent and structure.
- Translation can be idiomatic, but the workflow and conclusions should stay aligned.
- If you tighten or reroute a top-level page in English, make the parallel change in Chinese in the same patch.

## Writing Standards

- One page, one primary reader question.
- Keep headings clear and shallow.
- Prefer direct prose over decorative formatting.
- Keep commands runnable.
- Add success criteria for setup flows.
- Add “when to use this page” framing when a page could otherwise overlap with another section.

## VitePress and Markdown Notes

- Frontmatter is required for public pages.
- English content is served from root paths; Chinese content is served from `/zh/`.
- Locale navigation lives in `.vitepress/config/en.ts` and `.vitepress/config/zh.ts`.
- Assets belong in `docs/public/images/`.
- Use Mermaid when a diagram is the clearest explanation.

## Literal Template Syntax

VitePress renders through Vue. If docs need literal <span v-pre>`{{ }}`</span> syntax:

- Use `<span v-pre>` for short inline examples.
- Use `::: v-pre` for code blocks that contain template expressions.
- If inline dot-notation such as <span v-pre>`{{project.path}}`</span> still causes SSR issues, isolate that section with `<ClientOnly>`.

## Editing Checklist

Before finishing a docs change:

1. Confirm the page type.
2. Keep the current path unless explicitly asked to migrate it.
3. Update both locales for touched public pages.
4. Check internal links and cross-links.
5. Verify examples still match the current product story.
6. Run `pnpm docs:build`.

## Useful Files

- `.vitepress/config/index.ts`
- `.vitepress/config/en.ts`
- `.vitepress/config/zh.ts`
- `docs/README.md`
- `docs/en/index.md`
- `docs/en/guide/quick-start.md`
- `docs/en/guide/getting-started.md`
- `docs/en/commands/index.md`

Use the matching `zh/` pages whenever you change user-facing content.
