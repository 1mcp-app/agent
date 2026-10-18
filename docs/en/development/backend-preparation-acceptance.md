---
title: Backend setup and preparation verification
description: Contributor reproduction steps, recorded setup evidence, and acceptance gates for backend integrations.
---

# Backend setup and preparation verification

For contributors developing or reviewing backend integrations. End users should start with [backend preparation](/guide/backend-preparation) and [mcp setup](/commands/mcp/setup).

These are historical results retained from the PR head before the `mcp setup` command split. They have not been rerun for the current head; the reproduction command below is for a new verification run.

## Verified example scope

On 2026-10-16, the installed backends below passed setup and native-source acceptance on macOS 26.6.2 arm64 with Node.js 26.4.0. These are tested combinations, not a guarantee for other versions, platforms, languages, or repository sizes.

| Example           | Tested version                    | Representative public operation                                        | Result                             |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| CodeGraph         | 1.6.2                             | `codegraph_explore` returns selected-checkout source                   | Template and static targets passed |
| Code Review Graph | 2.3.9                             | `get_minimal_context_tool`, then `get_review_context_tool` with source | Template and static targets passed |
| Serena            | 2.0.0, individual-tools interface | Native instructions/onboarding guidance, then `find_symbol` with body  | Template and static targets passed |

Each backend returned unique source bodies from a main checkout, a linked worktree, and an independent repository. One reusable template configuration served all three, and main was queried again after the other checkouts. Fixtures included spaces, an ampersand, and an apostrophe in their paths. Dry runs, equivalent repeats (including `--force`), and preservation of unrelated configuration/secret references passed. All 21 native source queries passed across 12 isolated runtime lifecycles.

The fixtures contain one TypeScript source file per checkout. Serena used preinstalled TypeScript 5.9.3 and typescript-language-server 5.1.3 copied into an isolated home without downloads. Native initialization was explicit fixture setup: CodeGraph `init`, CRG `build`, and Serena `project create`. Native onboarding guidance was retained, not completed or fabricated by 1MCP. No automatic-preparation freshness, native-writer coordination, cancellation, or large-repository performance support is claimed.

Reproduce from a built source checkout with the named dependencies already installed:

```bash
python3 -B scripts/verify-known-server-setup.py \
  --cli "$PWD/build/index.js" \
  --codegraph /absolute/bin/codegraph \
  --crg /absolute/bin/code-review-graph \
  --serena /absolute/bin/serena \
  --serena-resources /absolute/serena-home
```

The harness writes commands, results, and `evidence.json` to a new OS temporary directory. It uses public 1MCP inspection/invocation and generated configurations, not placeholder substitution or native private APIs. Its cleanup verifies foreground process groups and observed descendants. Arbitrary fast daemonization/reparenting between observations is outside that harness contract; it is not a universal process-containment or runtime-preparation cancellation test.

## Real integration acceptance

CodeGraph and Code Review Graph use this same configured-command contract through external wrappers. Repository examples are in `examples/backend-preparation/README.md`, with a bounded native fixture wrapper and `scripts/verify-configured-preparation.mjs` for repeatable acceptance. Code Review Graph status alone does not establish dirty-source freshness; its wrapper must verify that separately or report the coverage gap. Runtime core contains no backend-specific readiness parser. Acceptance evidence must identify backend version, platform, checkout/source size, cold preparation time, warm probe overhead, shared jobs, unrelated ready-tool latency, cancellation coverage, and available CPU/memory observations. Passing local tests does not establish deployment or live client activation.

## Native diagnostics

- [Graph backend diagnostics](/development/preparation-native-acceptance)
- [Serena diagnostics](/development/preparation-serena-acceptance)
