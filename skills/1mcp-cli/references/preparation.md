# Backend preparation operations

Keep the same runtime (`--url`/`--context`), filters, and target overrides. The assigned session project is the default. Select a checkout for checkout-specific work and preserve `--operation` when supplied.

1. Inspect readiness with `1mcp project prepare inspect <backend>`, even when discovery is empty.
2. Run `1mcp project prepare start <backend>` only within existing user authorization and runtime permissions. A blocked operation does not authorize enabling automatic preparation or widening permissions.
3. Monitor an existing or returned job with `1mcp project prepare status <backend> <id>` or bounded `1mcp project prepare wait <backend> <id> --wait-ms 5000`.
4. After verified readiness, refresh server discovery, read applicable server instructions, inspect the tool schema, and submit a fresh call. Preparation never executes or replays the original tool call.

Report blocked or failed states. Use `1mcp project prepare retry <backend> <id>` only for deliberate authorized recovery, never an automatic retry loop. Cancel with `1mcp project prepare cancel <backend> <id>` only for owned work when appropriate; compatible callers may share the job.

For installing, adapting, or enabling preparation recipes, use the separately installed `1mcp-preparation-setup` skill. This operational reference does not authorize configuration changes.
