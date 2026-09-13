import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { captureJson } from '@src/core/validation/schemaPolicy.js';

import { createGatewayFailure, type ImmutableJsonValue, toImmutableJsonValue } from '../contracts/index.js';
import type { GatewayInteractionRequest, GatewayInteractionRound } from '../ports/outboundEraAdapter.js';
import { type InteractionBinding, type InteractionLimits, InteractionOwner } from './interactionOwner.js';

type Result = { value: ImmutableJsonValue } | { error: unknown };
interface Flow {
  readonly id: string;
  readonly binding: InteractionBinding;
  readonly signal: AbortSignal;
  readonly queue: Array<() => void>;
  current?: {
    requests: GatewayInteractionRound;
    responses: Readonly<Record<string, ImmutableJsonValue>>;
    token: string;
  };
  deliver?: (result: Result) => void;
  ready?: Result;
  sequence: number;
  pendingInputs: number;
  reserved?: boolean;
}

export interface InteractionBrokerOptions {
  readonly limits?: Partial<InteractionLimits>;
  /** The shared schema boundary owns validation; the broker never compiles schemas. */
  readonly validate: (
    request: GatewayInteractionRequest,
    response: unknown,
    binding: InteractionBinding,
  ) => Promise<void>;
  readonly validateRequest?: (request: GatewayInteractionRequest, binding: InteractionBinding) => Promise<void>;
  readonly authorize: (binding: InteractionBinding, request?: GatewayInteractionRequest) => boolean;
}

function rejected() {
  return createGatewayFailure({
    kind: 'authorization',
    code: 'interaction_state_invalid',
    message: 'Interaction continuation rejected',
  });
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Converts request-local reverse callbacks into MRTR without invoking an operation twice. */
export class InteractionBroker {
  private readonly owner: InteractionOwner;
  private readonly flows = new Map<string, Flow>();
  private readonly tokens = new Map<string, Flow>();

  constructor(private readonly options: InteractionBrokerOptions) {
    this.owner = new InteractionOwner(options.limits);
  }

  async start(
    binding: InteractionBinding,
    deadline: number,
    invoke: (
      interaction: (input: GatewayInteractionRequest) => Promise<ImmutableJsonValue>,
      signal: AbortSignal,
      interactionRound: (inputs: GatewayInteractionRound) => Promise<Readonly<Record<string, ImmutableJsonValue>>>,
    ) => Promise<ImmutableJsonValue>,
    callerSignal?: AbortSignal,
  ): Promise<ImmutableJsonValue> {
    if (!this.options.authorize(binding)) throw rejected();
    const operation = this.owner.start(binding, deadline);
    const flow: Flow = { ...operation, binding, queue: [], sequence: 0, pendingInputs: 0 };
    this.flows.set(flow.id, flow);
    const abort = () => this.owner.cancel(flow.id);
    callerSignal?.addEventListener('abort', abort, { once: true });
    flow.signal.addEventListener(
      'abort',
      () => {
        if (!this.flows.has(flow.id)) return;
        this.publish(flow, { error: flow.signal.reason });
        this.forget(flow);
      },
      { once: true },
    );
    if (callerSignal?.aborted) abort();
    void Promise.resolve()
      .then(() => {
        flow.signal.throwIfAborted();
        return invoke(
          (input) => this.interact(flow, input),
          flow.signal,
          (inputs) => this.interactRound(flow, inputs),
        );
      })
      .then(
        (value) => this.complete(flow, { value }),
        (error: unknown) => this.complete(flow, { error }),
      );
    try {
      return await this.next(flow);
    } finally {
      callerSignal?.removeEventListener('abort', abort);
    }
  }

  async resume(
    token: string,
    binding: InteractionBinding,
    responses: unknown,
    callerSignal?: AbortSignal,
    reauthorize?: () => Promise<boolean>,
  ): Promise<ImmutableJsonValue> {
    callerSignal?.throwIfAborted();
    const flow = this.tokens.get(digest(token));
    const current = flow?.current;
    if (
      !flow ||
      !current ||
      !Object.values(current.requests).every((request) => this.options.authorize(binding, request)) ||
      JSON.stringify(flow.binding) !== JSON.stringify(binding)
    )
      throw rejected();
    if (!responses || typeof responses !== 'object' || Array.isArray(responses)) throw rejected();
    const record = captureJson(responses, false).value as Record<string, ImmutableJsonValue>;
    const accepted: Record<string, ImmutableJsonValue> = {
      ...current.responses,
    };
    for (const [key, request] of Object.entries(current.requests)) {
      if (Object.hasOwn(current.responses, key) || !Object.hasOwn(record, key)) continue;
      await this.options.validate(request, record[key], binding);
      Object.defineProperty(accepted, key, {
        value: record[key],
        enumerable: true,
        configurable: true,
      });
    }
    const combined = captureJson(accepted, false).value as Readonly<Record<string, ImmutableJsonValue>>;
    callerSignal?.throwIfAborted();
    let allowed = false;
    try {
      allowed =
        (!reauthorize || (await reauthorize())) &&
        Object.values(current.requests).every((request) => this.options.authorize(binding, request));
    } catch {
      allowed = false;
    }
    if (!allowed) {
      this.owner.cancel(flow.id, 'authority_lost');
      throw rejected();
    }
    callerSignal?.throwIfAborted();
    if (flow.current !== current || this.tokens.get(digest(token)) !== flow) throw rejected();
    const missing = Object.fromEntries(
      Object.entries(current.requests).filter(([key]) => !Object.hasOwn(accepted, key)),
    );
    if (Object.keys(missing).length > 0) {
      // Keep valid inputs only within this native round; never send partial responses upstream.
      const successor = this.owner.rotate(token, binding);
      this.tokens.delete(digest(token));
      this.tokens.set(digest(successor), flow);
      flow.current = {
        requests: current.requests,
        responses: combined,
        token: digest(successor),
      };
      return toImmutableJsonValue({
        resultType: 'input_required',
        requestState: successor,
        inputRequests: missing,
      });
    }
    this.owner.resume(token, binding, combined);
    this.tokens.delete(digest(token));
    delete flow.current;
    flow.reserved = flow.queue.length > 0;
    flow.queue.shift()?.();
    const abort = () => this.owner.cancel(flow.id);
    callerSignal?.addEventListener('abort', abort, { once: true });
    if (callerSignal?.aborted) abort();
    try {
      return await this.next(flow);
    } finally {
      callerSignal?.removeEventListener('abort', abort);
    }
  }

  invalidate(binding: InteractionBinding): void {
    this.owner.invalidate(binding);
  }

  async close(): Promise<void> {
    await this.owner.close();
  }

  private async interact(flow: Flow, input: GatewayInteractionRequest): Promise<ImmutableJsonValue> {
    const key = String(++flow.sequence);
    const response = await this.interactRound(flow, { [key]: input });
    return response[key];
  }

  private async interactRound(
    flow: Flow,
    inputs: GatewayInteractionRound,
  ): Promise<Readonly<Record<string, ImmutableJsonValue>>> {
    flow.signal.throwIfAborted();
    if (
      inputs === null ||
      typeof inputs !== 'object' ||
      types.isProxy(inputs) ||
      Array.isArray(inputs) ||
      (Object.getPrototypeOf(inputs) !== Object.prototype && Object.getPrototypeOf(inputs) !== null)
    )
      throw rejected();
    const inputCount = Reflect.ownKeys(inputs).length;
    if (inputCount === 0) throw rejected();
    // Reserve actual inputs before copying payloads or suspending behind an active round.
    if (inputCount > 32 || flow.pendingInputs + inputCount > 32) {
      this.owner.cancel(flow.id, 'capacity_exceeded');
      throw rejected();
    }
    flow.pendingInputs += inputCount;
    try {
      const requests = captureJson(inputs, false).value as GatewayInteractionRound;
      const entries = Object.entries(requests);
      flow.signal.throwIfAborted();
      if (!entries.every(([, request]) => this.options.authorize(flow.binding, request))) throw rejected();
      if (flow.current || flow.reserved) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(flow.signal.reason);
          flow.signal.addEventListener('abort', abort, { once: true });
          flow.queue.push(() => {
            flow.signal.removeEventListener('abort', abort);
            resolve();
          });
        });
      }
      flow.signal.throwIfAborted();
      flow.reserved = true;
      try {
        for (const [, request] of entries) await this.options.validateRequest?.(request, flow.binding);
      } catch (error) {
        this.owner.cancel(flow.id, 'response_invalid');
        throw error;
      }
      flow.signal.throwIfAborted();
      const round = this.owner.park(flow.id, requests);
      flow.current = {
        requests,
        responses: {},
        token: digest(round.requestState),
      };
      flow.reserved = false;
      this.tokens.set(digest(round.requestState), flow);
      this.publish(flow, {
        value: toImmutableJsonValue({
          resultType: 'input_required',
          inputRequests: requests,
          requestState: round.requestState,
        }),
      });
      return (await round.response) as Readonly<Record<string, ImmutableJsonValue>>;
    } finally {
      flow.pendingInputs -= inputCount;
    }
  }

  private next(flow: Flow): Promise<ImmutableJsonValue> {
    const result = flow.ready;
    delete flow.ready;
    return (
      result
        ? Promise.resolve(result)
        : new Promise<Result>((resolve) => {
            flow.deliver = resolve;
          })
    ).then((settled) => {
      if ('error' in settled) throw settled.error;
      return settled.value;
    });
  }

  private publish(flow: Flow, result: Result): void {
    if (flow.deliver) {
      const deliver = flow.deliver;
      delete flow.deliver;
      deliver(result);
    } else flow.ready = result;
  }

  private complete(flow: Flow, result: Result): void {
    if (!this.flows.has(flow.id)) return;
    this.publish(flow, result);
    this.forget(flow);
    this.owner.finish(flow.id);
  }

  private forget(flow: Flow): void {
    this.flows.delete(flow.id);
    if (flow.current) this.tokens.delete(flow.current.token);
    flow.queue.length = 0;
  }
}
