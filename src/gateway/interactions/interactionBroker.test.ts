import { describe, expect, it, vi } from 'vitest';

import { InteractionBroker } from './interactionBroker.js';
import { type InteractionBinding, InteractionOwner } from './interactionOwner.js';

const binding: InteractionBinding = {
  principal: 'alice',
  request: 'tools/call:write',
  route: 'provider',
  generation: '1',
  inbound: 'modern',
  outbound: 'legacy',
};
const input = {
  method: 'elicitation/create' as const,
  params: { message: 'Confirm', requestedSchema: { type: 'object' } },
};

function frame(value: unknown): { requestState: string; inputRequests: Record<string, unknown> } {
  return value as { requestState: string; inputRequests: Record<string, unknown> };
}

describe('process-local interaction lifecycle', () => {
  it('counts 32 active native inputs before capturing or validating another input', async () => {
    const validateRequest = vi.fn(async () => undefined);
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined, validateRequest });
    let send!: (inputs: Record<string, typeof input>) => Promise<unknown>;
    const inputs = Object.fromEntries(Array.from({ length: 32 }, (_, key) => [String(key), input]));
    const initial = frame(
      await broker.start(binding, Date.now() + 5000, async (_interact, _signal, round) => {
        send = round;
        return round(inputs);
      }),
    );
    expect(Object.keys(initial.inputRequests)).toHaveLength(32);
    // This would fail strict capture if overflow were checked after copying the payload.
    const uncapturable = Object.defineProperty({ ...input }, 'params', { get: () => input.params });
    await expect(send({ extra: uncapturable })).rejects.toMatchObject({ code: 'interaction_state_invalid' });
    expect(validateRequest).toHaveBeenCalledTimes(32);
    await broker.close();
  });

  it('admits one active and 31 queued inputs but rejects the 33rd', async () => {
    const validateRequest = vi.fn(async () => undefined);
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined, validateRequest });
    let send!: (inputs: Record<string, typeof input>) => Promise<unknown>;
    await broker.start(binding, Date.now() + 5000, async (_interact, _signal, round) => {
      send = round;
      return round({ first: input });
    });
    let rejected = 0;
    const queued = Array.from({ length: 31 }, (_, key) =>
      send({ [key]: input }).catch((error: unknown) => {
        rejected++;
        return error;
      }),
    );
    await Promise.resolve();
    expect(rejected).toBe(0);
    expect(validateRequest).toHaveBeenCalledOnce();
    await expect(send({ overflow: input })).rejects.toMatchObject({ code: 'interaction_state_invalid' });
    for (const result of await Promise.all(queued))
      expect(result).toMatchObject({ code: 'interaction_capacity_exceeded' });
    await broker.close();
  });

  it('releases reserved inputs after capture fails', async () => {
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    const inputs = Object.fromEntries(Array.from({ length: 32 }, (_, key) => [String(key), input]));
    const uncapturable = Object.defineProperty({ ...input }, 'params', { get: () => input.params });
    const initial = frame(
      await broker.start(binding, Date.now() + 5000, async (_interact, _signal, round) => {
        await expect(round({ invalid: uncapturable })).rejects.toMatchObject({ code: 'schema_invalid' });
        return round(inputs);
      }),
    );
    expect(Object.keys(initial.inputRequests)).toHaveLength(32);
    const responses = Object.fromEntries(Object.keys(inputs).map((key) => [key, {}]));
    expect(await broker.resume(initial.requestState, binding, responses)).toEqual(responses);
    await broker.close();
  });

  it('bounds partial native response accumulation and keeps rejected payloads unconsumed', async () => {
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    const initial = frame(
      await broker.start(binding, Date.now() + 5000, async (_interact, _signal, round) => {
        await round({ a: input, b: input });
        return { done: true };
      }),
    );
    const partial = frame(await broker.resume(initial.requestState, binding, { a: 'x'.repeat(600_000) }));
    await expect(broker.resume(partial.requestState, binding, { b: 'x'.repeat(600_000) })).rejects.toBeDefined();
    expect(await broker.resume(partial.requestState, binding, { b: {} })).toEqual({ done: true });
    await broker.close();
  });

  it('counts empty partial rotations against the unchanged round cap', async () => {
    const broker = new InteractionBroker({
      limits: { rounds: 2 },
      authorize: () => true,
      validate: async () => undefined,
    });
    const initial = frame(
      await broker.start(binding, Date.now() + 5000, async (_interact, _signal, round) =>
        round({ a: input, b: input }),
      ),
    );
    const partial = frame(await broker.resume(initial.requestState, binding, { a: {} }));
    await expect(broker.resume(partial.requestState, binding, {})).rejects.toMatchObject({
      code: 'interaction_round_limit',
    });
    await broker.close();
  });
  it('keeps all 32 native inputs in one round and releases their responses together', async () => {
    const validate = vi.fn(async () => undefined);
    const broker = new InteractionBroker({ limits: { rounds: 1 }, authorize: () => true, validate });
    const keys = ['__proto__', 'constructor', ...Array.from({ length: 30 }, (_, index) => String(index))];
    const inputs = Object.fromEntries(keys.map((key) => [key, input]));
    let released = false;
    const initial = frame(
      await broker.start(binding, Date.now() + 5000, async (_interact, _signal, round) => {
        const responses = await round(inputs);
        released = true;
        return { keys: Object.keys(responses).length };
      }),
    );
    expect(Object.keys(initial.inputRequests)).toHaveLength(32);
    expect(released).toBe(false);
    const responses = Object.fromEntries(Object.keys(inputs).map((key) => [key, { action: 'accept' }]));
    expect(await broker.resume(initial.requestState, binding, responses)).toEqual({ keys: 32 });
    expect(validate).toHaveBeenCalledTimes(32);
    expect(Object.hasOwn(initial.inputRequests, '__proto__')).toBe(true);
    expect(Object.hasOwn(initial.inputRequests, 'constructor')).toBe(true);
    expect(Object.getPrototypeOf(responses)).toBe(Object.prototype);
    expect(released).toBe(true);
    await broker.close();
  });

  it('collects valid partials in the same native round without releasing a partial map', async () => {
    const broker = new InteractionBroker({
      authorize: () => true,
      validate: async (_request, response) => {
        if (response === null) throw new Error('invalid');
      },
    });
    let released = false;
    const initial = frame(
      await broker.start(binding, Date.now() + 5000, async (_interact, _signal, round) => {
        const responses = await round({ a: input, b: input });
        released = true;
        return responses;
      }),
    );
    const partial = frame(await broker.resume(initial.requestState, binding, { a: { action: 'accept' } }));
    expect(Object.keys(partial.inputRequests)).toEqual(['b']);
    expect(released).toBe(false);
    await expect(broker.resume(initial.requestState, binding, { b: {} })).rejects.toBeDefined();
    await expect(broker.resume(partial.requestState, binding, { b: null })).rejects.toThrow('invalid');
    expect(released).toBe(false);
    expect(await broker.resume(partial.requestState, binding, { a: 'ignored', b: { action: 'decline' } })).toEqual({
      a: { action: 'accept' },
      b: { action: 'decline' },
    });
    await broker.close();
  });

  it('does not release any response when the final item of a native batch is invalid', async () => {
    const broker = new InteractionBroker({
      authorize: () => true,
      validate: async (_request, response) => {
        if (response === null) throw new Error('invalid');
      },
    });
    let released = false;
    const initial = frame(
      await broker.start(binding, Date.now() + 5000, async (_interact, _signal, round) => {
        await round({ a: input, b: input });
        released = true;
        return {};
      }),
    );
    await expect(broker.resume(initial.requestState, binding, { a: {}, b: null })).rejects.toThrow('invalid');
    expect(released).toBe(false);
    await broker.close();
  });
  it('cancels the live operation when its active continuation request disconnects', async () => {
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    let operationSignal!: AbortSignal;
    const initial = frame(
      await broker.start(binding, Date.now() + 5000, async (interact, signal) => {
        operationSignal = signal;
        await interact(input);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (signal.aborted) reject(signal.reason);
        });
      }),
    );
    const controller = new AbortController();
    const continued = broker.resume(initial.requestState, binding, { '1': {} }, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(continued).rejects.toBeDefined();
    expect(operationSignal.aborted).toBe(true);
    await expect(broker.resume(initial.requestState, binding, { '1': {} })).rejects.toBeDefined();
    await broker.close();
  });
  it('rechecks authority after deferred validation before releasing the live operation', async () => {
    let release!: () => void;
    let authorized = true;
    const broker = new InteractionBroker({
      authorize: () => authorized,
      validate: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    let resumed = false;
    const pending = frame(
      await broker.start(binding, Date.now() + 5000, async (interact) => {
        await interact(input);
        resumed = true;
        return {};
      }),
    );
    const response = broker.resume(pending.requestState, binding, { '1': {} });
    authorized = false;
    release();
    await expect(response).rejects.toBeDefined();
    expect(resumed).toBe(false);
    await broker.close();
  });

  it('terminates rejected input validation even if upstream catches and asks again', async () => {
    const broker = new InteractionBroker({
      authorize: () => true,
      validate: async () => undefined,
      validateRequest: async () => {
        throw new Error('invalid input');
      },
    });
    await expect(
      broker.start(binding, Date.now() + 5000, async (interact) => {
        try {
          await interact(input);
        } catch {
          /* The backend cannot resurrect the cancelled owner. */
        }
        return interact(input);
      }),
    ).rejects.toMatchObject({ code: 'interaction_response_invalid' });
    await broker.close();
  });
  it('serializes concurrent callbacks without replay or timing windows', async () => {
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    const invoke = vi.fn(async (interact) => {
      const a = interact(input);
      const b = interact(input);
      await a;
      const c = interact(input);
      await Promise.all([b, c]);
      return { done: true };
    });
    let pending = frame(await broker.start(binding, Date.now() + 5000, invoke));
    for (let key = 1; key <= 3; key++) {
      expect(Object.keys(pending.inputRequests)).toEqual([String(key)]);
      const next = await broker.resume(pending.requestState, binding, { [key]: { action: 'accept' } });
      if (key < 3) pending = frame(next);
      else expect(next).toEqual({ done: true });
    }
    expect(invoke).toHaveBeenCalledOnce();
    await broker.close();
  });

  it('rotates a partial-response continuation and ignores unknown keys', async () => {
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    const initial = frame(await broker.start(binding, Date.now() + 5000, async (interact) => interact(input)));
    const successor = frame(await broker.resume(initial.requestState, binding, { ignored: true }));
    expect(successor.requestState).not.toBe(initial.requestState);
    await expect(broker.resume(initial.requestState, binding, { '1': {} })).rejects.toBeDefined();
    expect(await broker.resume(successor.requestState, binding, { '1': {}, ignored: true })).toEqual({});
    await broker.close();
  });

  it('cancels an active request but ignores a late cancel after its interim response', async () => {
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    const controller = new AbortController();
    const pending = frame(
      await broker.start(binding, Date.now() + 5000, async (interact) => interact(input), controller.signal),
    );
    controller.abort();
    expect(await broker.resume(pending.requestState, binding, { '1': {} })).toEqual({});
    const cancelled = new AbortController();
    cancelled.abort();
    const invoke = vi.fn();
    await expect(broker.start(binding, Date.now() + 5000, invoke, cancelled.signal)).rejects.toMatchObject({
      code: 'interaction_cancelled',
    });
    expect(invoke).not.toHaveBeenCalled();
    await broker.close();
  });
  it('parks the same operation across rounds and rejects racing and wrong-owner continuations', async () => {
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    const invoke = vi.fn(async (interact) => {
      await interact(input);
      await interact(input);
      return { content: [] };
    });
    const first = frame(await broker.start(binding, Date.now() + 5000, invoke));
    await expect(
      broker.resume(first.requestState, { ...binding, principal: 'bob' }, { '1': { action: 'accept' } }),
    ).rejects.toMatchObject({ code: 'interaction_state_invalid' });
    const second = frame(await broker.resume(first.requestState, binding, { '1': { action: 'accept' } }));
    await expect(broker.resume(first.requestState, binding, { '1': {} })).rejects.toBeDefined();
    const race = await Promise.allSettled([
      broker.resume(second.requestState, binding, { '2': { action: 'decline' } }),
      broker.resume(second.requestState, binding, { '2': { action: 'decline' } }),
    ]);
    expect(race.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    await broker.close();
  });

  it('does not consume invalid input and rechecks capability loss without touching another owner', async () => {
    let authorized = true;
    const broker = new InteractionBroker({
      authorize: () => authorized,
      validate: async (_input, response) => {
        if (response === null) throw new Error('invalid');
      },
    });
    const first = frame(await broker.start(binding, Date.now() + 5000, async (interact) => interact(input)));
    await expect(broker.resume(first.requestState, binding, { '1': null })).rejects.toThrow('invalid');
    authorized = false;
    await expect(broker.resume(first.requestState, binding, { '1': {} })).rejects.toBeDefined();
    authorized = true;
    expect(await broker.resume(first.requestState, binding, { '1': { action: 'cancel' } })).toEqual({
      action: 'cancel',
    });
    await broker.close();
  });

  it('rejects stale process handles and cancels only the affected binding', async () => {
    const broker = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    const first = frame(await broker.start(binding, Date.now() + 5000, async (interact) => interact(input)));
    const otherBinding = { ...binding, principal: 'bob' };
    const other = frame(await broker.start(otherBinding, Date.now() + 5000, async (interact) => interact(input)));
    broker.invalidate(binding);
    await expect(broker.resume(first.requestState, binding, { '1': {} })).rejects.toBeDefined();
    expect(await broker.resume(other.requestState, otherBinding, { '1': {} })).toEqual({});
    await broker.close();
    const restarted = new InteractionBroker({ authorize: () => true, validate: async () => undefined });
    await expect(restarted.resume(first.requestState, binding, { '1': {} })).rejects.toBeDefined();
    await restarted.close();
  });

  it('enforces per-owner and route admission before invocation and releases capacity', () => {
    const owner = new InteractionOwner({ perOwner: 1, perRoute: 2 });
    const first = owner.start(binding, Date.now() + 5000);
    expect(() => owner.start(binding, Date.now() + 5000)).toThrow();
    const second = owner.start({ ...binding, principal: 'bob' }, Date.now() + 5000);
    expect(() => owner.start({ ...binding, principal: 'carol' }, Date.now() + 5000)).toThrow();
    owner.finish(first.id);
    const replacement = owner.start(binding, Date.now() + 5000);
    owner.finish(second.id);
    owner.finish(replacement.id);
  });

  it('bounds rounds, payloads, lifetime and shutdown drain', async () => {
    vi.useFakeTimers();
    try {
      const owner = new InteractionOwner({ rounds: 1, payloadBytes: 32, ttlMs: 100, drainMs: 20 });
      const operation = owner.start(binding, Date.now() + 5000);
      expect(() => owner.park(operation.id, 'x'.repeat(33))).toThrow();
      const round = owner.park(operation.id, {});
      owner.resume(round.requestState, binding, {});
      await round.response;
      expect(() => owner.park(operation.id, {})).toThrow();
      const expiring = owner.start(binding, Date.now() + 5000);
      const parked = owner.park(expiring.id, {});
      await vi.advanceTimersByTimeAsync(100);
      await expect(parked.response).rejects.toMatchObject({ code: 'interaction_expired' });
      const closing = owner.close(() => new Promise(() => undefined));
      await vi.advanceTimersByTimeAsync(20);
      await closing;
    } finally {
      vi.useRealTimers();
    }
  });
});
