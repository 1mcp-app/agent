import { randomUUID } from 'node:crypto';

import {
  createLegacyTimeoutMs,
  type JsonValue,
  type LegacyRequestId,
  type LegacySdkAdapter,
} from '@src/sdk/contracts/index.js';

export async function requestLegacyAdapter<T = JsonValue>(
  adapter: LegacySdkAdapter,
  method: string,
  params?: JsonValue,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const requestId = randomUUID() as LegacyRequestId;
  const onAbort = () => void adapter.cancel(requestId);
  if (options.signal?.aborted) {
    await adapter.cancel(requestId);
    throw new Error('Request cancelled');
  }
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return (await adapter.request({
      id: requestId,
      method,
      ...(params === undefined ? {} : { params }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: createLegacyTimeoutMs(options.timeoutMs) }),
    })) as T;
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
