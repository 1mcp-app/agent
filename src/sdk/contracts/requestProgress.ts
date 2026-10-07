import { AsyncLocalStorage } from 'node:async_hooks';

import { z } from 'zod';

const progressSchema = z.object({
  progress: z.number().finite(),
  total: z.number().finite().optional(),
  message: z.string().max(4096).optional(),
});
const maxPending = 64;
const maxPendingBytes = 256 * 1024;
export interface RequestProgressNotification {
  readonly method: 'notifications/progress';
  readonly params: { progressToken: string | number; progress: number; total?: number; message?: string };
}
interface Owner {
  accepting: boolean;
  active: boolean;
  pending: number;
  bytes: number;
  tail: Promise<void>;
  failure?: unknown;
  readonly token: string | number;
  readonly signal?: AbortSignal;
  readonly assertCurrent?: () => void;
  readonly send: (notification: RequestProgressNotification) => Promise<void>;
}
const owners = new AsyncLocalStorage<Owner | undefined>();

async function drain(owner: Owner): Promise<void> {
  if (owner.signal?.aborted) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    await Promise.race([
      owner.tail,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1000);
        abort = resolve;
        owner.signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) owner.signal?.removeEventListener('abort', abort);
  }
}

/** Retain an opaque scalar token exactly; it never becomes an upstream request token. */
export function requestProgressToken(value: unknown): string | number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024) return undefined;
  return value;
}

/** One inbound exchange owns a bounded delivery queue, independently of any SDK request id. */
export async function withRequestProgress<T>(
  token: unknown,
  send: Owner['send'],
  operation: () => Promise<T>,
  signal?: AbortSignal,
  assertCurrent?: () => void,
): Promise<T> {
  const validated = requestProgressToken(token);
  if (validated === undefined) return owners.run(undefined, operation);
  const owner: Owner = {
    accepting: true,
    active: true,
    pending: 0,
    bytes: 0,
    tail: Promise.resolve(),
    token: validated,
    send,
    signal,
    assertCurrent,
  };
  try {
    return await owners.run(owner, async () => {
      signal?.throwIfAborted();
      const result = await operation();
      owner.accepting = false;
      // Optional progress cannot change an already completed operation's outcome.
      await drain(owner);
      return result;
    });
  } finally {
    owner.accepting = false;
    owner.active = false;
  }
}

/** SDK onprogress already correlates a private SDK token; never accept raw notifications here. */
export function currentRequestProgress(): ((progress: unknown) => void) | undefined {
  const owner = owners.getStore();
  if (!owner?.active) return undefined;
  return (progress) => {
    if (!owner.accepting || !owner.active || owner.signal?.aborted || owner.failure !== undefined) return;
    if (typeof progress !== 'object' || progress === null) return;
    let parsed: ReturnType<typeof progressSchema.safeParse>;
    try {
      const values = Object.fromEntries(
        ['progress', 'total', 'message'].flatMap((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(progress, key);
          if (!descriptor) return [];
          if (!('value' in descriptor)) throw new Error('Invalid progress field');
          return [[key, descriptor.value as unknown]];
        }),
      );
      parsed = progressSchema.safeParse(values);
    } catch {
      return;
    }
    if (!parsed.success) return;
    const notification: RequestProgressNotification = {
      method: 'notifications/progress',
      params: { ...parsed.data, progressToken: owner.token },
    };
    const bytes = Buffer.byteLength(JSON.stringify(notification));
    if (owner.pending >= maxPending || owner.bytes + bytes > maxPendingBytes) {
      owner.failure = new Error('Request progress delivery capacity exceeded');
      return;
    }
    owner.pending++;
    owner.bytes += bytes;
    owner.tail = owner.tail
      .then(async () => {
        if (!owner.active || owner.signal?.aborted || owner.failure !== undefined) return;
        owner.assertCurrent?.();
        await owner.send(notification);
      })
      .catch((error: unknown) => {
        owner.failure ??= error;
      })
      .finally(() => {
        owner.pending--;
        owner.bytes -= bytes;
      });
  };
}
