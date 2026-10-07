import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';

import { captureJson } from '@src/core/validation/schemaPolicy.js';
import type { LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import {
  createGatewayFailure,
  type GatewayOperation,
  type ImmutableJsonValue,
  toImmutableJsonValue,
} from '../contracts/index.js';

interface InitialScope {
  readonly operation: string;
  readonly identity: string;
  readonly inputs: Readonly<Record<string, ImmutableJsonValue>>;
}
interface SelectedScope {
  readonly adapter: object;
  readonly operation: string;
  readonly identity: string;
  readonly inputs: Readonly<Record<string, ImmutableJsonValue>>;
  consumed: boolean;
}
const owned = new WeakSet<InitialScope>();
const claimed = new WeakSet<InitialScope>();
const initial = new AsyncLocalStorage<InitialScope | undefined>();
const selected = new AsyncLocalStorage<SelectedScope | undefined>();
const supported = new Set(['tools/call', 'prompts/get', 'resources/read']);

function isRecord(value: ImmutableJsonValue): value is Readonly<Record<string, ImmutableJsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid() {
  return createGatewayFailure({
    kind: 'invalid-request',
    code: 'invalid_initial_input_responses',
    message: 'Initial input responses are invalid',
  });
}

/** Capture the SDK's accepted driver record before any source acquisition await. */
export function captureNativeInitialInputResponses(
  operation: GatewayOperation,
  params: unknown,
  value: unknown,
): InitialScope | undefined {
  if (value === undefined || !supported.has(operation)) return undefined;
  let inputs: ImmutableJsonValue;
  try {
    inputs = toImmutableJsonValue(captureJson(value, false).value);
  } catch {
    throw invalid();
  }
  if (!isRecord(inputs)) throw invalid();
  if (!params || typeof params !== 'object' || Array.isArray(params) || types.isProxy(params)) throw invalid();
  const descriptor = Object.getOwnPropertyDescriptor(params, operation === 'resources/read' ? 'uri' : 'name');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') throw invalid();
  const scope: InitialScope = Object.freeze({ operation, identity: descriptor.value, inputs });
  owned.add(scope);
  return scope;
}

export function runWithNativeInitialInputResponses<T>(
  scope: InitialScope | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (scope !== undefined && !owned.has(scope)) throw invalid();
  return initial.run(scope, operation);
}

/** Only an authoritative external handler may claim the resolved execution route. */
export function withSelectedNativeInputResponses<T>(
  publicIdentity: string,
  operation: string,
  adapter: LegacySdkAdapter,
  upstreamIdentity: string,
  execute: () => Promise<T>,
): Promise<T> {
  const scope = initial.getStore();
  if (
    !scope ||
    claimed.has(scope) ||
    scope.operation !== operation ||
    scope.identity !== publicIdentity ||
    adapter.protocol?.era !== 'modern'
  )
    return selected.run(undefined, execute);
  claimed.add(scope);
  return selected.run(
    { adapter, operation, identity: upstreamIdentity, inputs: scope.inputs, consumed: false },
    execute,
  );
}

/** Consume once at the selected modern adapter; catalog and nested calls cannot borrow it. */
export function takeNativeInitialInputResponses(
  adapter: object,
  operation: string,
  params: unknown,
): Readonly<Record<string, ImmutableJsonValue>> | undefined {
  const scope = selected.getStore();
  if (
    !scope ||
    scope.consumed ||
    scope.adapter !== adapter ||
    scope.operation !== operation ||
    !supported.has(operation)
  )
    return undefined;
  if (!params || typeof params !== 'object' || Array.isArray(params) || types.isProxy(params)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(params, operation === 'resources/read' ? 'uri' : 'name');
  if (!descriptor || !('value' in descriptor) || descriptor.value !== scope.identity) return undefined;
  scope.consumed = true;
  return scope.inputs;
}
