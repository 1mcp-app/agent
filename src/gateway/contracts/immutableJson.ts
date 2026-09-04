import { type JsonValue, toJsonValue } from '@src/sdk/contracts/jsonValue.js';

export type ImmutableJsonValue =
  null | boolean | number | string | readonly ImmutableJsonValue[] | { readonly [key: string]: ImmutableJsonValue };

function freezeValue(value: JsonValue): ImmutableJsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freezeValue(child)])));
  }
  return value;
}

/** Detaches, validates, and recursively freezes a value crossing the gateway boundary. */
export function toImmutableJsonValue(value: unknown): ImmutableJsonValue {
  return freezeValue(toJsonValue(value));
}
