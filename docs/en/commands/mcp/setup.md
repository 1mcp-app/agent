---
title: mcp setup
description: Configure installed CodeGraph, Code Review Graph, or Serena backends using maintained examples.
---

# mcp setup

Configure an already installed backend without writing JSON. This command supports CodeGraph, Code Review Graph, and Serena. Use [mcp install](/commands/mcp/install) to browse and install registry servers.

Setup is a convenience for generating server configuration. To customize or share automatic preparation, configure `preparation.definition` in `mcp.json` using a [referenced recipe](/guide/backend-preparation). Setup preserves existing custom recipes, inputs, activation choices, disables, and permissions, including with `--force`. The three maintained examples do not supply verified native preparation recipes.

## Synopsis

Choose a maintained example interactively:

```bash
1mcp mcp setup
```

Select an example directly:

```bash
1mcp mcp setup --known codegraph
1mcp mcp setup --known code-review-graph
1mcp mcp setup --known serena
```

## Options

| Option                       | Behavior                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--interactive, -i`          | Prompt for missing prerequisites and confirm configuration when selecting an example directly.                                     |
| `--known <id>`               | Select `codegraph`, `code-review-graph`, or `serena`; omit to choose interactively.                                                |
| `--executable <path>`        | Use an installed executable at this path instead of discovering it on PATH.                                                        |
| `--checkout <absolute-path>` | Configure a static checkout target. Omit for a reusable checkout-bound template.                                                   |
| `--name <name>`              | Set the local configuration name; defaults to the example ID.                                                                      |
| `--dry-run`                  | Validate and preview without saving or launching a backend.                                                                        |
| `--force`                    | Explicitly reconfigure an existing example while preserving unrelated settings and overrides. Equivalent setup is already a no-op. |

The command also accepts global configuration selectors such as `--config` and `--config-dir`.

## Examples

Preview a reusable template with an explicit executable:

```bash
1mcp mcp setup --known codegraph --executable /absolute/bin/codegraph --dry-run
```

Preview a fixed checkout target:

```bash
1mcp mcp setup --known serena --checkout /absolute/project --name project-serena --dry-run
```

Remove `--dry-run` to save. By default, the template uses the checkout selected and authorized by the project-context workflow. The setup command's working directory does not bind that template. Later, select a checkout with `1mcp inspect serena --project /absolute/project`.

## Results and limitations

Successful setup reports configuration changes and reload observation separately from native readiness. Repeating equivalent setup leaves the configuration unchanged. Meaningful reconfiguration requires `--force`; static/template name collisions fail rather than silently moving a target. Existing overrides, secret references, disables, and preparation restrictions are preserved.

Install backend executables and language dependencies first. Missing prerequisites produce guidance; setup does not download dependencies, initialize indexes, complete onboarding, or grant checkout access. It does not enable automatic preparation or prove source freshness. If a runtime is running, saving a static backend can start it through normal configuration reload; native startup retains its own behavior.

## Tested versions

The setup examples were tested on macOS 26.6.2 arm64 with Node.js 26.4.0, CodeGraph 1.6.2, Code Review Graph 2.3.9, and Serena 2.0.0 (individual-tools interface). The Serena TypeScript example used TypeScript 5.9.3 and typescript-language-server 5.1.3. Other versions, platforms, languages, and large repositories are outside this tested scope. These setup checks do not establish automatic preparation support.

## See also

- [Backend preparation](/guide/backend-preparation) — current support, supplied recipes, and preparation progress.
- [Project checkouts](/guide/project-checkouts) — target selection and authorization.
- [mcp install](/commands/mcp/install) — registry installation.
