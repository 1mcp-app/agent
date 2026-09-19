import { createHash, randomBytes } from 'node:crypto';

import { captureJson, SCHEMA_LIMITS } from '@src/core/validation/schemaPolicy.js';

import { createGatewayFailure, type ImmutableJsonValue, toImmutableJsonValue } from '../contracts/index.js';

export interface InteractionBinding {
  readonly principal: string;
  readonly request: string;
  readonly route: string;
  readonly provider?: string;
  readonly generation: string;
  readonly inbound: string;
  readonly outbound: string;
}

export interface InteractionLimits {
  readonly active: number;
  readonly perOwner: number;
  readonly perRoute: number;
  readonly rounds: number;
  readonly payloadBytes: number;
  readonly ttlMs: number;
  readonly drainMs: number;
}

interface Round {
  readonly token: string;
  readonly resolve: (value: ImmutableJsonValue) => void;
  readonly reject: (reason: unknown) => void;
}

interface Operation {
  readonly binding: string;
  readonly principal: string;
  readonly route: string;
  readonly deadline: number;
  readonly controller: AbortController;
  readonly timer: ReturnType<typeof setTimeout>;
  rounds: number;
  round?: Round;
}

// All listener/broker and direct legacy owners share the accepted process capacity.
const processOperations = new Map<string, Operation>();

const defaults: InteractionLimits = {
  active: 128,
  perOwner: 16,
  perRoute: 32,
  rounds: 10,
  payloadBytes: SCHEMA_LIMITS.inputBytes,
  ttlMs: 600_000,
  drainMs: 1000,
};

function tokenKey(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw failure('state_invalid');
  return createHash('sha256').update(token).digest('hex');
}

function failure(code: string) {
  return createGatewayFailure({
    kind: 'invalid-request',
    code: `interaction_${code}`,
    message: 'Interaction is unavailable or cannot accept this continuation',
    data: { outcome: 'unknown' },
  });
}

function bindingKey(binding: InteractionBinding): string {
  const parts = [
    binding.principal,
    binding.request,
    binding.route,
    binding.provider ?? binding.route,
    binding.generation,
    binding.inbound,
    binding.outbound,
  ];
  if (parts.some((part) => typeof part !== 'string' || !part)) throw failure('binding_required');
  return JSON.stringify(parts);
}

/** Owns live promises only. Tokens are unguessable references, never serialized authority. */
export class InteractionOwner {
  private readonly operations = new Map<string, Operation>();
  private readonly tokens = new Map<string, string>();
  private readonly limits: InteractionLimits;
  private closed = false;

  constructor(
    limits: Partial<InteractionLimits> = {},
    private readonly now = Date.now,
  ) {
    this.limits = { ...defaults, ...limits };
    if (
      Object.entries(this.limits).some(
        ([key, value]) => !Number.isSafeInteger(value) || value < 0 || (value === 0 && key !== 'ttlMs'),
      )
    ) {
      throw new TypeError('Interaction limits must be positive integers');
    }
    if (
      this.limits.active > 2048 ||
      this.limits.perOwner > 128 ||
      this.limits.perRoute > 512 ||
      this.limits.rounds > 10 ||
      this.limits.ttlMs > 3_600_000
    )
      throw new TypeError('Interaction hard limit exceeded');
  }

  start(binding: InteractionBinding, deadline: number): { id: string; signal: AbortSignal } {
    const key = bindingKey(binding);
    let ownerCount = 0;
    let routeCount = 0;
    for (const operation of processOperations.values()) {
      if (operation.principal === binding.principal) ownerCount++;
      if (operation.route === (binding.provider ?? binding.route)) routeCount++;
    }
    if (
      this.closed ||
      processOperations.size >= this.limits.active ||
      ownerCount >= this.limits.perOwner ||
      routeCount >= this.limits.perRoute
    )
      throw failure('capacity_exceeded');
    const expires = Math.min(deadline, this.now() + this.limits.ttlMs);
    if (!Number.isSafeInteger(expires) || expires <= this.now()) throw failure('expired');
    const id = randomBytes(32).toString('base64url');
    const controller = new AbortController();
    const timer = setTimeout(() => this.cancel(id, 'expired'), expires - this.now());
    timer.unref();
    this.operations.set(id, {
      binding: key,
      principal: binding.principal,
      route: binding.provider ?? binding.route,
      deadline: expires,
      controller,
      timer,
      rounds: 0,
    });
    processOperations.set(id, this.operations.get(id)!);
    return { id, signal: controller.signal };
  }

  park(
    id: string,
    input: unknown,
  ): { requestState: string; input: ImmutableJsonValue; response: Promise<ImmutableJsonValue> } {
    const operation = this.operations.get(id);
    if (!operation || operation.deadline <= this.now()) throw failure('expired');
    if (operation.round) throw failure('round_pending');
    if (operation.rounds >= this.limits.rounds) {
      this.cancel(id, 'round_limit');
      throw failure('round_limit');
    }
    const value = this.payload(input);
    const token = randomBytes(32).toString('base64url');
    const response = new Promise<ImmutableJsonValue>((resolve, reject) => {
      operation.round = { token: tokenKey(token), resolve, reject };
    });
    // A peer may disconnect before the parked callback attaches its await.
    void response.catch(() => undefined);
    operation.rounds++;
    this.tokens.set(tokenKey(token), id);
    return { requestState: token, input: value, response };
  }

  resume(token: string, binding: InteractionBinding, input: unknown): string {
    const digest = tokenKey(token);
    const id = this.tokens.get(digest);
    const operation = id === undefined ? undefined : this.operations.get(id);
    if (!operation || operation.binding !== bindingKey(binding) || operation.deadline <= this.now()) {
      throw failure('continuation_rejected');
    }
    const round = operation.round;
    if (!round || round.token !== digest) throw failure('continuation_rejected');
    const value = this.payload(input);
    // Consume synchronously before waking the same live operation.
    this.tokens.delete(digest);
    delete operation.round;
    round.resolve(value);
    return id!;
  }

  rotate(token: string, binding: InteractionBinding): string {
    const previous = tokenKey(token);
    const id = this.tokens.get(previous);
    const operation = id === undefined ? undefined : this.operations.get(id);
    if (
      !operation ||
      operation.binding !== bindingKey(binding) ||
      operation.deadline <= this.now() ||
      !operation.round ||
      operation.round.token !== previous
    )
      throw failure('continuation_rejected');
    if (operation.rounds >= this.limits.rounds) {
      this.cancel(id!, 'round_limit');
      throw failure('round_limit');
    }
    const next = randomBytes(32).toString('base64url');
    this.tokens.delete(previous);
    operation.round = { ...operation.round, token: tokenKey(next) };
    operation.rounds++;
    this.tokens.set(tokenKey(next), id!);
    return next;
  }

  finish(id: string): void {
    this.cancel(id, 'completed');
  }

  cancel(id: string, reason = 'cancelled'): void {
    const operation = this.operations.get(id);
    if (!operation) return;
    this.operations.delete(id);
    processOperations.delete(id);
    clearTimeout(operation.timer);
    if (operation.round) {
      this.tokens.delete(operation.round.token);
      operation.round.reject(failure(reason));
    }
    operation.controller.abort(failure(reason));
  }

  invalidate(binding: InteractionBinding): void {
    const key = bindingKey(binding);
    for (const [id, operation] of this.operations) {
      if (operation.binding === key) this.cancel(id, 'authority_lost');
    }
  }

  async close(drain: () => Promise<void> = async () => undefined): Promise<void> {
    this.closed = true;
    for (const id of this.operations.keys()) this.cancel(id, 'interrupted');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        drain(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.limits.drainMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private payload(input: unknown): ImmutableJsonValue {
    const value = toImmutableJsonValue(captureJson(input, false).value);
    if (Buffer.byteLength(JSON.stringify(value)) > this.limits.payloadBytes) throw failure('payload_limit');
    return value;
  }
}
