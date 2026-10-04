import {
  boundedDescription,
  errorFacts,
  type FieldRule,
  MAX_EVENT_BYTES,
  MAX_EVENT_FIELDS,
  normalizeField,
  ownData,
} from '../privacy/fields.js';
import { getActiveTraceCorrelation } from '../tracing/context.js';
import { EVENT_REGISTRY, type EventName } from './registry.js';

type FieldInput<R> = R extends 'number'
  ? number
  : R extends 'boolean'
    ? boolean
    : R extends 'error'
      ? unknown
      : R extends 'methods'
        ? readonly string[]
        : string;
export type EventFields<E extends EventName> = E extends EventName
  ? keyof (typeof EVENT_REGISTRY)[E]['fields'] extends never
    ? Record<string, never>
    : { [K in keyof (typeof EVENT_REGISTRY)[E]['fields']]?: FieldInput<(typeof EVENT_REGISTRY)[E]['fields'][K]> }
  : never;
export interface LocalEvent {
  event: EventName;
  message: string;
  [key: string]: string | number | boolean | string[];
}

/** Admission boundary before any retained sink. No caller object survives normalization. */
export function normalizeEvent(name: unknown, input?: unknown): LocalEvent | undefined {
  if (typeof name !== 'string' || name.length > 256 || !Object.hasOwn(EVENT_REGISTRY, name)) return undefined;
  const event = name as EventName;
  const definition = EVENT_REGISTRY[event];
  const result: LocalEvent = { event, message: boundedDescription(definition.message) };
  let dropped = 0;
  for (const [key, rule] of Object.entries(definition.fields) as [string, FieldRule][]) {
    const value = ownData(input, key);
    if (value === undefined) continue;
    if (rule === 'error') {
      Object.assign(result, errorFacts(value));
      continue;
    }
    const normalized = normalizeField(rule, value);
    if (normalized === undefined) {
      dropped++;
      continue;
    }
    result[rule.startsWith('identity:') ? `${key}_fingerprint` : key] = normalized;
  }
  if (dropped) result.dropped_values = dropped;
  const correlation = getActiveTraceCorrelation();
  if (correlation) Object.assign(result, correlation);
  if (Object.keys(result).length > MAX_EVENT_FIELDS) return undefined;
  // Reserve timestamp/level and the text sink framing overhead.
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_EVENT_BYTES - 256) return undefined;
  return result;
}
