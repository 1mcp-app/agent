# AGENTS.md

This file tells coding agents how to edit public documentation, architectural decisions, and repository development notes under `docs/`.

## Mission

Improve the docs without breaking the existing public path structure.

Use the current site model:

- `index.md` pages are entrypoints.
- `guide/` teaches or helps complete tasks.
- `commands/` documents CLI behavior precisely.
- `reference/` is for exact lookup and architecture.

Do not turn one page into multiple content types at once.

## Non-Negotiables

- Keep the current `docs/site/en/**` and `docs/site/zh/**` file layout unless explicitly asked to restructure it.
- Preserve SEO-sensitive URLs.
- Update both locales for any user-facing page you materially change. Repository development notes are English-only.
- Use absolute internal site links for public pages; use repository file links as described below for development notes.
- Run `pnpm docs:build` after docs edits.

## Docs-Specific Commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

## Development Documentation Placement

- Put maintained contributor workflows, diagnostic procedures, and implementation constraints in `docs/development/`. Put run-specific results, acceptance evidence, and delivery history in the relevant PR, issue, or CI artifacts.
- VitePress builds only `docs/site/`; repository notes stay outside that directory. Public pages belong in its locale directories.
- Keep these development documents outside `docs/site/en/` and `docs/site/zh/` and out of public site navigation. Maintain development documents in English only; both site locales link to the same English repository file.
- Keep user-facing setup instructions, prerequisites, supported behavior, and limitations in the localized site. The existing public development guide may link to repository notes rather than embedding their evidence or harness details.
- Use relative file links between repository notes and full documentation-site URLs for links from notes to public pages. Public pages linking to repository notes must use GitHub file URLs, not VitePress routes.
- When moving development content, update all incoming links and navigation. Retain a short routing page only for an existing public URL that must remain accessible.

## Content-Type Rules

### Contributor handbook (`docs/development/`)

- Each page must answer a recurring contributor question: how to change, test, or diagnose a subsystem, or which constraints make a change safe. A completed task alone does not justify a new page.
- Document the current workflow. Include purpose, prerequisites, commands, expected observations, and failure interpretation where relevant; reference pages need only the structure their subject requires.
- Preserve knowledge that is difficult to recover from code: hidden prerequisites, cross-component relationships, and non-obvious constraints. Link to owning scripts, tests, and configuration instead of copying assertion inventories or settings tables.
- Keep dated results, pass counts, rollout narratives, screenshots, and task checklists with their PR, issue, or CI run. Distinguish a procedure's expected outcome from an observed result; a historical pass is not current support evidence.
- Update the existing explanation when behavior changes. Remove obsolete instructions and migration narration; preserve durable decision rationale in ADRs. Version pins belong here only when required to run the documented workflow.
- Link each page from the [development index](development/README.md) or a relevant contributor guide. Prefer extending an existing page over adding a second page for the same task.
- Update affected procedures and links with behavior changes. Merge or remove pages that no longer answer a useful question, repairing incoming links. Before finishing, ask: what can a contributor do or understand better because this page exists?

### Architectural decision records (`docs/adr/`)

- Apply the `domain-modeling` skill when recording or revising architectural decisions. Create an ADR only when the decision is costly to reverse, surprising without context, and the result of a real trade-off. All three criteria must hold.
- Default to a short title and one paragraph of 1–3 sentences covering context, decision, and rationale. Add status, considered alternatives, or consequences only when they help a future reader understand the decision.
- Record durable architectural boundaries, constraints, and reasons. ADRs must not contain development details: code snippets, file-by-file changes, implementation plans, task checklists, reproduction commands, test matrices, or acceptance evidence.
- Put implementation and verification notes in `docs/development/`. Put issue requirements and delivery plans in the issue tracker following [the issue-tracker instructions](agents/issue-tracker.md). Link to those details when needed instead of embedding them in the ADR.
- Keep ADRs in English and use sequential `NNNN-short-slug.md` names; choose the next number after the highest existing ADR. When a decision changes, make its status and any superseding ADR explicit.

### Domain terminology

- Use the canonical terms in `GLOSSARY.md` when present. Capture resolved definitions there using the `domain-modeling` skill; keep the glossary limited to domain meanings, without implementation details, specifications, or decision history.

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
- Locale navigation lives in `site/.vitepress/config/en.ts` and `site/.vitepress/config/zh.ts`.
- Assets belong in `docs/site/public/images/`.
- Use Mermaid when a diagram is the clearest explanation.

## Literal Template Syntax

VitePress renders through Vue. If docs need literal <span v-pre>`{{ }}`</span> syntax:

- Use `<span v-pre>` for short inline examples.
- Use `::: v-pre` for code blocks that contain template expressions.
- If inline dot-notation such as <span v-pre>`{{project.path}}`</span> still causes SSR issues, isolate that section with `<ClientOnly>`.

## Editing Checklist

Before finishing a docs change:

1. Confirm the page type and keep its content within the corresponding rules above.
2. Keep the current path unless explicitly asked to migrate it.
3. Update both locales for touched public pages.
4. Check internal links and cross-links.
5. Verify examples still match the current product story.
6. Run `pnpm docs:build`.

## Useful Files

- `site/.vitepress/config/index.ts`
- `site/.vitepress/config/en.ts`
- `site/.vitepress/config/zh.ts`
- `docs/README.md`
- `docs/site/en/index.md`
- `docs/site/en/guide/quick-start.md`
- `docs/site/en/guide/getting-started.md`
- `docs/site/en/commands/index.md`

Use the matching `zh/` pages whenever you change user-facing content.
