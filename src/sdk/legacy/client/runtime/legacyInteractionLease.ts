import { AsyncLocalStorage } from 'node:async_hooks';

import { type LegacySdkAdapter, OneMcpProtocolError } from '@src/sdk/contracts/index.js';

const ownerContext = new AsyncLocalStorage<{ signal?: AbortSignal; logLevel?: string; capabilities?: unknown }>();
const leases = new WeakMap<LegacySdkAdapter, { owner?: object; running: boolean }>();

/** Reserve the actual adapter, including callers outside the MCP protocol handlers. */
export async function withLegacyInteractionLease<T>(
  adapter: LegacySdkAdapter,
  operation: () => Promise<T>,
  signal?: AbortSignal,
  logLevel?: string,
  capabilities?: unknown,
): Promise<T> {
  if (leases.has(adapter)) throw new OneMcpProtocolError(-32000, 'interaction_capacity_exceeded');
  const owner = { signal, logLevel, capabilities };
  leases.set(adapter, { owner, running: false });
  try {
    return await ownerContext.run(owner, operation);
  } finally {
    leases.delete(adapter);
  }
}

export function beginLegacyInteractionRequest(adapter: LegacySdkAdapter, method: string): () => void {
  if (!['tools/call', 'prompts/get', 'resources/read'].includes(method)) return () => undefined;
  const lease = leases.get(adapter);
  if (lease) {
    if (lease.owner !== ownerContext.getStore() || lease.running)
      throw new OneMcpProtocolError(-32000, 'interaction_capacity_exceeded');
    lease.running = true;
    return () => {
      lease.running = false;
    };
  }
  leases.set(adapter, { running: true });
  return () => {
    leases.delete(adapter);
  };
}

export function currentLegacyInteractionSignal(): AbortSignal | undefined {
  return ownerContext.getStore()?.signal;
}

export function currentLegacyInteractionLogLevel(): string | undefined {
  return ownerContext.getStore()?.logLevel;
}

export function currentLegacyInteractionCapabilities(): unknown {
  return ownerContext.getStore()?.capabilities;
}
