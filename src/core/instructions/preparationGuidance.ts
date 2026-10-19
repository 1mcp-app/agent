/** Shared recovery guidance for managed bootstrap and built-in CLI instructions. */
export const PREPARATION_GUIDANCE = [
  'Backend preparation (when required):',
  'Retain the same runtime (--url/--context), filters, and assigned --project/--project-set selection on every prepare command. Select one checkout for checkout-specific work; preserve --operation when supplied.',
  'Use `1mcp project prepare inspect <backend>` to read readiness without starting work, even when tool discovery is empty. Request needed preparation with `1mcp project prepare start <backend>` only within existing user authorization and runtime permissions; do not enable automatic preparation or widen permissions to bypass a block.',
  'If a job ID is returned or already exists, monitor it with `1mcp project prepare status <backend> <id>` or bounded `1mcp project prepare wait <backend> <id> --wait-ms 5000`. Preparation never executes or replays the original tool call.',
  'After verified readiness, refresh server discovery and inspect the tool schema, then submit a fresh tool call. Report blocked or failed states; use `1mcp project prepare retry <backend> <id>` only for deliberate authorized recovery, never an automatic retry loop. Cancel owned work with `1mcp project prepare cancel <backend> <id>` only when appropriate for the task; compatible callers may share it.',
].join('\n');
