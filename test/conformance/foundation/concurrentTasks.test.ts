import { describe, expect, it, vi } from 'vitest';

import { runConformanceTasks } from './concurrentTasks.js';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('bounded conformance execution', () => {
  it('uses two slots and retains plan order when tasks complete out of order', async () => {
    const gates = Array.from({ length: 4 }, () => deferred<string>());
    const started: number[] = [];
    const results = runConformanceTasks([0, 1, 2, 3], (index) => {
      started.push(index);
      return gates[index].promise;
    });
    expect(started).toEqual([0, 1]);
    gates[1].resolve('second');
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    gates[2].resolve('third');
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    gates[3].resolve('fourth');
    gates[0].resolve('first');
    await expect(results).resolves.toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('stops scheduling after a failure and waits for in-flight cleanup before rejecting', async () => {
    const cleanup = deferred<void>();
    const entered = deferred<void>();
    const failure = new Error('evidence-write-failed');
    const started: number[] = [];
    let settled = false;
    let cleaned = false;
    const results = runConformanceTasks([0, 1, 2], async (index) => {
      started.push(index);
      if (index === 0) {
        await entered.promise;
        throw failure;
      }
      entered.resolve();
      await cleanup.promise;
      cleaned = true;
      return index;
    });
    const rejection = expect(results).rejects.toBe(failure);
    void results.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(started).toEqual([0, 1]);
    cleanup.resolve();
    await rejection;
    expect(cleaned).toBe(true);
    expect(started).toEqual([0, 1]);
  });

  it('does not start work for an empty plan', async () => {
    const execute = vi.fn();
    await expect(runConformanceTasks([], execute)).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
