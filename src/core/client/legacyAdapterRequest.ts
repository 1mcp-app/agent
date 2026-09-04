import { randomUUID } from 'node:crypto';

import {
  createLegacyTimeoutMs,
  type JsonValue,
  type LegacyRequestId,
  type LegacySdkAdapter,
  OneMcpProtocolError,
} from '@src/sdk/contracts/index.js';

function numericProtocolError(error: unknown): OneMcpProtocolError | undefined {
  if (error instanceof OneMcpProtocolError) return error;
  if (typeof error !== 'object' || error === null) return undefined;
  const codeDescriptor = Object.getOwnPropertyDescriptor(error, 'code');
  const messageDescriptor = Object.getOwnPropertyDescriptor(error, 'message');
  if (!codeDescriptor || !('value' in codeDescriptor) || !messageDescriptor || !('value' in messageDescriptor)) {
    return undefined;
  }
  const rawCode: unknown = codeDescriptor.value;
  if (
    (typeof rawCode !== 'number' && (typeof rawCode !== 'string' || !/^-?\d+$/.test(rawCode))) ||
    typeof messageDescriptor.value !== 'string'
  ) {
    return undefined;
  }
  const numericCode = Number(rawCode);
  if (!Number.isSafeInteger(numericCode)) return undefined;
  const dataDescriptor = Object.getOwnPropertyDescriptor(error, 'data');
  return new OneMcpProtocolError(
    numericCode,
    messageDescriptor.value,
    dataDescriptor && 'value' in dataDescriptor ? dataDescriptor.value : undefined,
  );
}

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
  } catch (error) {
    throw numericProtocolError(error) ?? error;
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
