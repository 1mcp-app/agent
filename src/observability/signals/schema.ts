import { types } from 'node:util';

import { z } from 'zod';

/** Closed signal vocabulary, independent of the richer local event registry. */
export const OPERATION_REGISTRY = {
  initialize: 'session',
  'server/discover': 'session',
  'subscriptions/listen': 'subscriptions',
  ping: 'session',
  'tools/list': 'tools',
  'tools/call': 'tools',
  'resources/list': 'resources',
  'resources/read': 'resources',
  'resources/templates/list': 'resources',
  'resources/subscribe': 'subscriptions',
  'resources/unsubscribe': 'subscriptions',
  'prompts/list': 'prompts',
  'prompts/get': 'prompts',
  'completion/complete': 'completion',
  'logging/setLevel': 'logging',
  'sampling/createMessage': 'sampling',
  'elicitation/create': 'elicitation',
  'roots/list': 'roots',
  'notifications/initialized': 'session',
  'notifications/cancelled': 'session',
  'notifications/progress': 'session',
  'notifications/message': 'logging',
  'notifications/tools/list_changed': 'tools',
  'notifications/resources/list_changed': 'resources',
  'notifications/resources/updated': 'subscriptions',
  'notifications/prompts/list_changed': 'prompts',
  'notifications/roots/list_changed': 'roots',
  'notifications/elicitation/complete': 'elicitation',
} as const;
export function classifyOperation(method: unknown): { method: string; family: string } {
  if (typeof method !== 'string' || !Object.hasOwn(OPERATION_REGISTRY, method))
    return { method: 'other', family: 'other' };
  return { method, family: OPERATION_REGISTRY[method as keyof typeof OPERATION_REGISTRY] };
}
export const PHASES = [
  'operation',
  'proxy-forward',
  'routing',
  'schema',
  'cache',
  'interaction',
  'subscription',
  'aggregation',
  'connection',
  'http-request',
  'http-sse',
  'http-mcp',
  'http-oauth',
  'http-health',
  'http-other',
] as const;
export const OUTCOMES = [
  'success',
  'caller-error',
  'denied',
  'not-found',
  'cancelled',
  'tool-error',
  'upstream-error',
  'transport-error',
  'invalid-response',
  'aborted',
  'internal-error',
  'draining',
] as const;
export type OperationOutcome = (typeof OUTCOMES)[number];
export const dimensionsSchema = z.strictObject({
  operation_family: z
    .enum([
      'session',
      'tools',
      'resources',
      'subscriptions',
      'prompts',
      'completion',
      'logging',
      'sampling',
      'elicitation',
      'roots',
      'other',
    ])
    .optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  era_pair: z.enum(['legacy-legacy', 'legacy-modern', 'modern-legacy', 'modern-modern', 'unknown']).optional(),
  transport: z.enum(['stdio', 'streamable-http', 'sse']).optional(),
  phase: z.enum(PHASES).optional(),
  outcome: z.enum(OUTCOMES).optional(),
  failure_kind: z
    .enum([
      'protocol',
      'invalid-request',
      'authorization',
      'deadline-exceeded',
      'cancelled',
      'transport',
      'internal',
      'other',
    ])
    .optional(),
  failure_code: z
    .enum([
      'gateway_overloaded',
      'runtime_draining',
      'gateway_target_unavailable',
      'resource_not_found',
      'schema_evaluation_timeout',
      'schema_evaluation_unavailable',
      'missing_required_client_capability',
      'gateway_protocol_error',
      'gateway_invalid_request_error',
      'gateway_authorization_error',
      'gateway_deadline_exceeded_error',
      'gateway_cancelled_error',
      'gateway_transport_error',
      'gateway_internal_error',
      'other',
    ])
    .optional(),
  dispatch_state: z.enum(['not-dispatched', 'dispatched', 'acknowledged', 'unknown']).optional(),
  queue: z.enum(['admission', 'upstream', 'interaction', 'subscription']).optional(),
  cache: z.enum(['schema', 'capability', 'routing', 'discovery']).optional(),
  cache_outcome: z.enum(['hit', 'miss', 'evicted', 'invalidated']).optional(),
  connection_state: z.enum(['connecting', 'connected', 'disconnected', 'failed']).optional(),
  lifecycle: z.enum(['started', 'completed', 'cancelled', 'expired', 'rejected']).optional(),
});
export type MeasurementDimensions = z.infer<typeof dimensionsSchema>;
export const operationSchema = z.strictObject({
  kind: z.enum(['server', 'client', 'internal', 'http']),
  httpDirection: z.enum(['inbound', 'outbound']).optional(),
  method: z.string().optional(),
  transport: z.enum(['stdio', 'streamable-http', 'sse']).optional(),
  inboundEra: z.enum(['legacy', 'modern']).optional(),
  outboundEra: z.enum(['legacy', 'modern']).optional(),
  phase: z.enum(PHASES).optional(),
  dispatchState: z.enum(['not-dispatched', 'dispatched', 'acknowledged', 'unknown']).optional(),
  // Carrier stays outside Zod traversal: read only through the existing propagation boundary.
  remoteParams: z.unknown().optional(),
});
export type TelemetryOperationOptions = z.infer<typeof operationSchema>;
export const outcomeSchema = z.union([
  z.enum(OUTCOMES),
  z.strictObject({
    outcome: z.enum(OUTCOMES),
    failureKind: dimensionsSchema.shape.failure_kind,
    failureCode: dimensionsSchema.shape.failure_code,
    dispatchState: dimensionsSchema.shape.dispatch_state,
  }),
]);
export type TelemetryOperationResult = z.infer<typeof outcomeSchema>;
/** Refuse accessors/proxies before schema parsing, including arbitrary metadata. */
export function dataRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) return undefined;
    Object.defineProperty(result, key, { value: descriptor.value as unknown, enumerable: true });
  }
  return result;
}
export const METRIC_REGISTRY = {
  'mcp.client.operation.duration': { kind: 'histogram', unit: 's', cap: 1024 },
  'mcp.server.operation.duration': { kind: 'histogram', unit: 's', cap: 1024 },
  'gateway.phase.duration': { kind: 'histogram', unit: 's', cap: 1024 },
  'gateway.active.operations': { kind: 'updown', unit: '{operation}', cap: 256 },
  'gateway.failures': { kind: 'counter', unit: '{failure}', cap: 512 },
  'gateway.queue.depth': { kind: 'gauge', unit: '{operation}', cap: 256 },
  'gateway.queue.overflow': { kind: 'counter', unit: '{operation}', cap: 512 },
  'gateway.cache.outcomes': { kind: 'counter', unit: '{lookup}', cap: 512 },
  'gateway.upstream.connections': { kind: 'gauge', unit: '{connection}', cap: 256 },
  'gateway.interaction.lifecycle': { kind: 'counter', unit: '{interaction}', cap: 512 },
  'gateway.subscription.lifecycle': { kind: 'counter', unit: '{subscription}', cap: 512 },
} as const;
export type MeasurementName = keyof typeof METRIC_REGISTRY;
export const METRIC_ATTRIBUTE_KEYS = Object.keys(dimensionsSchema.shape);
/** Privacy-limited MCP metric names/seconds from the immutable GenAI convention source. */
export const CONVENTION_REVISION = 'f49da22056925ae9ba78ec5dd7fe1fa559adce05';
export const CONVENTION_SOURCE = `https://github.com/open-telemetry/semantic-conventions-genai/blob/${CONVENTION_REVISION}/docs/gen-ai/mcp.md`;

Object.freeze(OPERATION_REGISTRY);
for (const instrument of Object.values(METRIC_REGISTRY)) Object.freeze(instrument);
Object.freeze(METRIC_REGISTRY);
Object.freeze(PHASES);
Object.freeze(OUTCOMES);
