# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo uses a single-context domain documentation layout.

## Before exploring, read these

- `CONTEXT.md` at the repo root, if it exists
- `docs/adr/`, if it exists, for architectural decisions relevant to the area being changed

If these files do not exist, proceed silently. The producer skill creates them lazily when terms or decisions get resolved.

## File structure

```text
/
|-- CONTEXT.md
|-- docs/adr/
`-- src/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `CONTEXT.md`. Map unambiguous shorthand to that vocabulary. Ask only when competing meanings would materially change behavior, data ownership, compatibility, or acceptance criteria and available evidence cannot resolve them.

## Flag ADR conflicts

Surface substantive ADR conflicts explicitly and explain their consequences. Continue work consistent with existing decisions; do not silently change an architectural decision outside the authorized scope. A conflict report is not automatically a request for approval: ask when resolving it requires an unapproved architectural change or a material decision that available evidence cannot resolve.
