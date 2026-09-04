import type { JsonValue } from '@src/sdk/contracts/index.js';

/** Removes caller-owned protocol metadata before an outbound hop regenerates it. */
export function stripInboundRequestMeta(params: JsonValue | undefined): JsonValue | undefined {
  if (params === null || Array.isArray(params) || typeof params !== 'object' || !('_meta' in params)) return params;
  const { _meta: _untrustedMeta, ...businessParams } = params;
  return businessParams;
}
