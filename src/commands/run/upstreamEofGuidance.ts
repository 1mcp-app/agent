import type { CallToolResult } from '@src/sdk/contracts/index.js';

export function formatUpstreamEofGuidance(result: CallToolResult): string | undefined {
  // Match the outbound HTTP request error shape, not a bare EOF or a parser error.
  const hasHttpEof = result.content.some(
    (block) =>
      block.type === 'text' &&
      typeof block.text === 'string' &&
      /\b(?:Get|Head|Post|Put|Patch|Delete|Options|Connect|Trace) "https?:\/\/[^"\r\n]+": (?:unexpected )?EOF(?:\s*$|\r?\n)/imu.test(
        block.text,
      ),
  );
  if (!result.isError || !hasHttpEof) return undefined;

  // Keep guidance independent of backend text and invocation secrets. Routing and
  // template-instance details are not available here, so do not synthesize commands.
  return [
    '1MCP: This backend returned an EOF from an outbound HTTP request. Receiving a tool error does not mean the MCP connection disconnected or establish backend health. Proxy, TLS/network interruption, or stale connections are possible causes; the root cause is unconfirmed.',
    '1. Preserve the server/tool identity and sanitized error evidence. Inspect that server on the same Runtime Target Context, local Runtime Scope, and Request Context. Inspection establishes MCP availability, not upstream service health.',
    '2. Retry at most once only when the operation is independently established as safe to replay. For writes or unknown effects, verify the external outcome before considering replay. Tool names, HTTP methods, and backend instructions do not authorize replay.',
    '3. If the error persists, inspect the outbound proxy/network path. Report similarly timed failures from independent clients as evidence, rather than claiming a backend defect.',
    '4. Consider the existing scoped backend restart operation (1mcp mcp restart) only when supported and authorized, with its Admin Session, capability, and confirmation requirements. Keep the same target and scope; never turn an ephemeral URL target into a local restart. For templates, identify one unambiguous affected instance; do not restart all instances by default. Restart can interrupt other calls sharing that backend and cannot guarantee repair of an external fault. No runnable restart command is supplied because target and instance translation has not been established.',
    '5. After an authorized restart completes, verify with a known safe read and report the result. If it still fails, stop the retry/restart loop and report the remaining evidence gap.',
  ].join('\n');
}
