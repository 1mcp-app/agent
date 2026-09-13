import { captureJson } from '@src/core/validation/schemaPolicy.js';

import {
  createEffectiveRequestAuthority,
  createGatewayFailure,
  gatewayFailureFromUnknown,
  type ImmutableJsonValue,
  type ProtocolEraPin,
  toImmutableJsonValue,
} from '../../contracts/index.js';
import type { OutboundEraAdapter, OutboundGatewayRequest } from '../../ports/index.js';
import type {
  GatewayInteractionRequest,
  GatewayInteractionRound,
  GatewayRequestOptions,
} from '../../ports/outboundEraAdapter.js';
import { requireModernPin } from './modernPin.js';

function isRecord(value: unknown): value is { readonly [key: string]: ImmutableJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface ModernOutboundAdapterCallbacks {
  /** Receives a detached, recursively frozen JSON request frame. */
  readonly request: (request: ImmutableJsonValue) => Promise<unknown>;
  /** Receives the exact gateway request id being cancelled. */
  readonly cancel: (requestId: string) => Promise<void>;
  readonly close?: () => Promise<void>;
}

export interface ModernOutboundEraAdapterOptions extends ModernOutboundAdapterCallbacks {
  readonly revision: unknown;
  readonly now?: () => number;
}

/** Modern-only outbound shell. It is intentionally unattached to a backend factory. */
export class ModernOutboundEraAdapter implements OutboundEraAdapter {
  readonly role = 'outbound' as const;
  readonly pin: ProtocolEraPin;
  readonly #callbacks: ModernOutboundAdapterCallbacks;
  readonly #now: () => number;
  readonly #activeRequestIds = new Set<string>();
  readonly #cancelledRequestIds = new Set<string>();

  constructor(options: ModernOutboundEraAdapterOptions) {
    this.pin = requireModernPin(options.revision);
    this.#callbacks = Object.freeze({
      request: options.request,
      cancel: options.cancel,
      ...(options.close === undefined ? {} : { close: options.close }),
    });
    this.#now = options.now ?? Date.now;
    Object.freeze(this);
  }

  async request(request: OutboundGatewayRequest, options?: GatewayRequestOptions): Promise<ImmutableJsonValue> {
    let frame = toImmutableJsonValue({
      requestId: request.requestId,
      operation: request.operation,
      ...(request.params === undefined ? {} : { params: request.params }),
      authority: createEffectiveRequestAuthority(request.authority),
      deadlineUnixMs: request.deadlineUnixMs,
    });
    if (this.#activeRequestIds.has(request.requestId)) {
      throw createGatewayFailure({
        kind: 'invalid-request',
        code: 'modern_outbound_duplicate_request',
        message: 'The modern outbound request id is already active',
      });
    }
    if (request.deadlineUnixMs <= this.#now()) {
      throw createGatewayFailure({
        kind: 'deadline-exceeded',
        code: 'gateway_deadline_exceeded',
        message: 'The gateway request deadline has expired',
      });
    }

    this.#activeRequestIds.add(request.requestId);
    try {
      let stateOnly = 0;
      for (let round = 0; ; round++) {
        if (this.#cancelledRequestIds.has(request.requestId) || request.deadlineUnixMs <= this.#now()) {
          throw createGatewayFailure({
            kind: 'cancelled',
            code: 'interaction_expired',
            message: 'Interaction expired or cancelled',
          });
        }
        const result = toImmutableJsonValue(captureJson(await this.#callbacks.request(frame), false, true).value);
        if (!isRecord(result) || result.resultType !== 'input_required') return result;
        if (!['tools/call', 'prompts/get', 'resources/read'].includes(request.operation) || round >= 10) {
          throw createGatewayFailure({
            kind: 'protocol',
            code: 'interaction_round_limit',
            message: 'Interaction is unsupported or exhausted',
          });
        }
        const inputs = result.inputRequests;
        if (inputs !== undefined && (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)))
          throw new TypeError('Invalid interaction inputs');
        const entries = Object.entries(inputs ?? {});
        if (
          entries.length > 32 ||
          (entries.length === 0 && typeof result.requestState !== 'string') ||
          (result.requestState !== undefined &&
            (typeof result.requestState !== 'string' || Buffer.byteLength(result.requestState) > 65_536))
        ) {
          throw new TypeError('Invalid interaction round');
        }
        stateOnly = entries.length === 0 ? stateOnly + 1 : 0;
        if (stateOnly > 3) throw new TypeError('Interaction state-only limit exceeded');
        if (entries.length && !options?.interaction && !options?.interactionRound)
          throw createGatewayFailure({
            kind: 'authorization',
            code: 'interaction_capability_required',
            message: 'Interaction provider required',
          });
        for (const [, input] of entries) {
          if (
            !isRecord(input) ||
            !['elicitation/create', 'sampling/createMessage', 'roots/list'].includes(String(input.method))
          )
            throw new TypeError('Invalid interaction kind');
        }
        let responses: Record<string, ImmutableJsonValue> = {};
        if (entries.length && options?.interactionRound) {
          const received = captureJson(
            await options.interactionRound(inputs as unknown as GatewayInteractionRound),
            false,
          ).value;
          if (!isRecord(received) || entries.some(([key]) => !Object.hasOwn(received, key)))
            throw new TypeError('Incomplete interaction round');
          responses = Object.fromEntries(entries.map(([key]) => [key, received[key]]));
        } else {
          for (const [key, input] of entries) {
            Object.defineProperty(responses, key, {
              value: await options!.interaction!(input as unknown as GatewayInteractionRequest),
              enumerable: true,
            });
          }
        }
        if (stateOnly)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(25 * stateOnly, Math.max(0, request.deadlineUnixMs - this.#now()))),
          );
        frame = toImmutableJsonValue({
          requestId: `${request.requestId}:round:${round + 1}`,
          cancellationId: request.requestId,
          operation: request.operation,
          ...(request.params === undefined ? {} : { params: request.params }),
          authority: createEffectiveRequestAuthority(request.authority),
          deadlineUnixMs: request.deadlineUnixMs,
          inputResponses: responses,
          ...(result.requestState === undefined ? {} : { requestState: result.requestState }),
        });
      }
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    } finally {
      this.#activeRequestIds.delete(request.requestId);
      this.#cancelledRequestIds.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    if (!this.#activeRequestIds.has(requestId) || this.#cancelledRequestIds.has(requestId)) return;
    this.#cancelledRequestIds.add(requestId);
    try {
      await this.#callbacks.cancel(requestId);
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
  }

  async close(): Promise<void> {
    try {
      await this.#callbacks.close?.();
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
  }
}
