/** Shared preparation guidance for installed playbooks and runtime instructions. */
export const PREPARATION_GUIDANCE = [
  '## Backend preparation (when required)',
  '',
  'Keep the same runtime (--url/--context), filters and target overrides; the assigned session project is the default. Select a checkout for checkout-specific work and preserve --operation when supplied. Use the session ownership rules above.',
  '',
  '1. Read readiness with `1mcp project prepare inspect <backend>`, even when discovery is empty.',
  '2. Run `1mcp project prepare start <backend>` only within existing user authorization and runtime permissions. Never enable automatic preparation or widen permissions to bypass a block.',
  '3. Monitor an existing or returned job with `1mcp project prepare status <backend> <id>` or bounded `1mcp project prepare wait <backend> <id> --wait-ms 5000`.',
  '4. After verified readiness, refresh server discovery and inspect the tool schema, then submit a fresh call: preparation never executes or replays the original tool call.',
  '',
  'Report blocked/failed states. Use `1mcp project prepare retry <backend> <id>` only for deliberate authorized recovery, never an automatic retry loop. Use `1mcp project prepare cancel <backend> <id>` only for owned work when appropriate; compatible callers may share it.',
].join('\n');
