import { describe, expect, it, vi } from 'vitest';

import { currentRequestProgress, requestProgressToken, withRequestProgress } from './requestProgress.js';

describe('request-owned progress', () => {
  it('keeps opaque valid tokens and rejects oversized or non-scalar tokens', () => {
    for (const token of ['', ' exact token ', 0, 1.25]) expect(requestProgressToken(token)).toBe(token);
    for (const token of [undefined, null, {}, [], NaN, Infinity, 'x'.repeat(1025)])
      expect(requestProgressToken(token)).toBeUndefined();
  });

  it('clears inherited ownership when an exchange has no valid token', async () => {
    await withRequestProgress(
      'outer',
      async () => {},
      async () => {
        expect(currentRequestProgress()).toBeTypeOf('function');
        await withRequestProgress(
          undefined,
          async () => {},
          async () => {
            expect(currentRequestProgress()).toBeUndefined();
          },
        );
        expect(currentRequestProgress()).toBeTypeOf('function');
      },
    );
  });

  it('projects only standard fields and flushes before returning the completed result', async () => {
    const notes: unknown[] = [];
    let finish!: () => void;
    const delivered = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = withRequestProgress(
      'caller',
      async (note) => {
        await delivered;
        notes.push(note);
      },
      async () => {
        currentRequestProgress()!({
          progress: 2,
          total: 3,
          message: 'two',
          progressToken: 'foreign',
          _meta: { secret: true },
          extra: 'secret',
        });
        return 'completed';
      },
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    expect(await pending).toBe('completed');
    expect(notes).toEqual([
      { method: 'notifications/progress', params: { progressToken: 'caller', progress: 2, total: 3, message: 'two' } },
    ]);
  });

  it('isolates simultaneous owners, including identical tokens, and ignores late callbacks', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const late: Array<(progress: unknown) => void> = [];
    await Promise.all(
      [first, second].map((send, index) =>
        withRequestProgress('same', send, async () => {
          const callback = currentRequestProgress()!;
          late.push(callback);
          await Promise.resolve();
          callback({ progress: index });
        }),
      ),
    );
    expect(first).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'same', progress: 0 },
    });
    expect(second).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'same', progress: 1 },
    });
    late.forEach((callback) => callback({ progress: 99 }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(currentRequestProgress()).toBeUndefined();
  });

  it('does not reopen a parked first-exchange owner when its logical closure resumes', async () => {
    const initial = vi.fn(async () => {});
    const resumed = vi.fn(async () => {});
    let oldProgress!: (progress: unknown) => void;
    await withRequestProgress('first-exchange', initial, async () => {
      oldProgress = currentRequestProgress()!;
    });
    await withRequestProgress('continuation-exchange', resumed, async () => {
      oldProgress({ progress: 1 });
      currentRequestProgress()!({ progress: 2 });
    });
    expect(initial).not.toHaveBeenCalled();
    expect(resumed).toHaveBeenCalledExactlyOnceWith({
      method: 'notifications/progress',
      params: { progressToken: 'continuation-exchange', progress: 2 },
    });
  });

  it.each(['abort', 'generation'])(
    'drops queued progress after %s without changing the completed result',
    async (change) => {
      const controller = new AbortController();
      const send = vi.fn(async () => {});
      let current = true;
      const result = await withRequestProgress(
        0,
        send,
        async () => {
          currentRequestProgress()!({ progress: 0 });
          if (change === 'abort') controller.abort();
          else current = false;
          return 'completed';
        },
        controller.signal,
        () => {
          if (!current) throw new Error('generation changed');
        },
      );
      expect(result).toBe('completed');
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('drops malformed and overflowing progress without replaying or changing a completed operation', async () => {
    const send = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      const callback = currentRequestProgress()!;
      callback({ progress: Infinity });
      callback(
        Object.defineProperty({}, 'progress', {
          get: () => {
            throw new Error('must not access');
          },
        }),
      );
      callback({ progress: 1, message: 'x'.repeat(4097) });
      for (let index = 0; index < 65; index++) callback({ progress: index });
      return 'completed';
    });
    expect(await withRequestProgress('caller', send, operation)).toBe('completed');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a completed result when notification delivery rejects or never settles', async () => {
    vi.useFakeTimers();
    try {
      const rejected = vi.fn(async () => {
        throw new Error('sink unavailable');
      });
      expect(
        await withRequestProgress('caller', rejected, async () => {
          currentRequestProgress()!({ progress: 1 });
          return 'completed';
        }),
      ).toBe('completed');
      const blocked = withRequestProgress(
        'caller',
        () => new Promise<void>(() => {}),
        async () => {
          currentRequestProgress()!({ progress: 1 });
          return 'completed';
        },
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(await blocked).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });
});
