import { AsyncLocalStorage } from 'node:async_hooks';

import { createGatewayFailure } from '../contracts/index.js';
import type { GatewayRequestOptions } from '../ports/outboundEraAdapter.js';

interface InteractionRoute {
  readonly adapter: object;
  readonly method: string;
  readonly identity: string;
  readonly isCurrent?: () => boolean;
}
const routes = new AsyncLocalStorage<InteractionRoute>();
const nativeRounds = new AsyncLocalStorage<NonNullable<GatewayRequestOptions['interactionRound']>>();

export function withNativeInteractionRound<T>(
  handler: NonNullable<GatewayRequestOptions['interactionRound']>,
  operation: () => Promise<T>,
): Promise<T> {
  return nativeRounds.run(handler, operation);
}

export function currentNativeInteractionRound(): GatewayRequestOptions['interactionRound'] {
  return nativeRounds.getStore();
}

export function withInteractionRoute<T>(pin: InteractionRoute, operation: () => Promise<T>): Promise<T> {
  return routes.run(Object.freeze({ ...pin }), operation);
}

/** A freshly recreated private peer may implement only the already-authorized source route. */
export function withDerivedInteractionRoute<T>(
  original: object,
  child: object,
  operation: () => Promise<T>,
): Promise<T> {
  const pin = routes.getStore();
  if (!pin || pin.adapter !== original || pin.isCurrent?.() === false) {
    throw createGatewayFailure({
      kind: 'authorization',
      code: 'interaction_lost',
      message: 'Interaction route is no longer available',
    });
  }
  return withInteractionRoute({ ...pin, adapter: child }, operation);
}

/** Runs at the actual provider boundary, after private bridge routing/catalog acquisition. */
export function assertInteractionRoute(adapter: object, method: string, params: unknown): void {
  const pin = routes.getStore();
  if (!pin || !['tools/call', 'prompts/get', 'resources/read'].includes(method)) return;
  const key = method === 'resources/read' ? 'uri' : 'name';
  const identity = params && typeof params === 'object' ? (params as Record<string, unknown>)[key] : undefined;
  if (pin.adapter !== adapter || pin.method !== method || pin.identity !== identity || pin.isCurrent?.() === false) {
    throw createGatewayFailure({
      kind: 'authorization',
      code: 'interaction_lost',
      message: 'Interaction route is no longer available',
    });
  }
}
