---
title: Runtime Target Context Commands
description: Manage verified named 1MCP runtime targets and their local metadata.
---

# Runtime Target Context Commands

Runtime Target Contexts are verified, named runtime endpoints. A named context can carry locally saved bearer credentials; an ephemeral `--url` connection cannot. Use a context for repeatable remote workflows.

```bash
1mcp target <subcommand> [options]
```

## Add and Select

```bash
1mcp target add <name> <url> [options]
1mcp target use <name> [options]
```

`target add` verifies the Runtime Identity endpoint before storing the target.

- `add`: `--use`, `--display-name <label>`, `--ca-file <path>`, `--insecure-skip-verify`, `--replace`, `--accept-new-identity`.
- `use`: `--accept-insecure-tls`, `--json`.

```bash
1mcp target add prod https://mcp.example.com/mcp --use
1mcp target add staging https://mcp.example.com/mcp --ca-file ./company-ca.pem
```

## Inspect and Verify

```bash
1mcp target current
1mcp target list
1mcp target inspect <name>
1mcp target verify <name> [--accept-insecure-tls] [--json]
```

`current` and `list` do not contact a runtime. `verify` confirms the saved target identity.

## Import, Export, and Repair

```bash
1mcp target export [--output <file>]
1mcp target import <file> [--dry-run] [--json]
1mcp target doctor [--fix-secrets] [--prune-orphans]
```

Use `-` as the import file to read a bundle from stdin. `doctor --fix-secrets` repairs local secret-store permissions; `--prune-orphans` removes credential references for missing targets.

## Rename and Delete

```bash
1mcp target rename <old> <new>
1mcp target delete <name> [--force]
```

`delete --force` also permits deletion of the current context.

## Use a Context

The `--context <name>` selector is implemented by `instructions`, `inspect`, `run`, and `proxy`:

```bash
1mcp instructions --context prod
1mcp inspect --context prod filesystem/read_file
1mcp run --context prod filesystem/read_file --args '{"path":"./README.md"}'
1mcp proxy --context prod
```

For bearer authentication, store the token against the named context first:

```bash
1mcp auth login --context prod --token "$TOKEN"
```

See [auth](/commands/auth) and [proxy](/commands/proxy).
