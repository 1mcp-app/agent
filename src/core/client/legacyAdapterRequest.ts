import { randomUUID } from 'node:crypto';

import {
  createLegacyTimeoutMs,
  type JsonValue,
  type LegacyRequestId,
  type LegacySdkAdapter,
  OneMcpProtocolError,
} from '@src/sdk/contracts/index.js';

import { z } from 'zod';

const protocolErrorSnapshotSchema = z.object({
  code: z
    .union([z.number(), z.string().regex(/^-?\d+$/)])
    .transform(Number)
    .refine(Number.isSafeInteger),
  message: z.string(),
  data: z.unknown().optional(),
});

function numericProtocolError(error: unknown): OneMcpProtocolError | undefined {
  if (error instanceof OneMcpProtocolError) return error;
  if (typeof error !== 'object' || error === null) return undefined;
  const codeDescriptor = Object.getOwnPropertyDescriptor(error, 'code');
  const messageDescriptor = Object.getOwnPropertyDescriptor(error, 'message');
  if (!codeDescriptor || !('value' in codeDescriptor) || !messageDescriptor || !('value' in messageDescriptor)) {
    return undefined;
  }
  const dataDescriptor = Object.getOwnPropertyDescriptor(error, 'data');
  const snapshot = protocolErrorSnapshotSchema.safeParse({
    code: codeDescriptor.value as unknown,
    message: messageDescriptor.value as unknown,
    data: (dataDescriptor && 'value' in dataDescriptor ? dataDescriptor.value : undefined) as unknown,
  });
  return snapshot.success
    ? new OneMcpProtocolError(snapshot.data.code, snapshot.data.message, snapshot.data.data)
    : undefined;
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
