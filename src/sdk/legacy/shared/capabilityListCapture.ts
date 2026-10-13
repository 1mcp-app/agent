import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

import {
  isCapabilityListMethod,
  JSON_VALUE_LIMITS,
  type JsonValue,
  type JsonValueLimits,
  RESPONSE_JSON_VALUE_LIMITS,
  toJsonValue,
} from '@src/sdk/contracts/index.js';

import { assertCanonicalToolResult } from './schemaProjection.js';

/** Keep malformed template syntax local to one catalog source capability. */
export function captureCapabilityListResult(method: string, result: unknown, limits?: JsonValueLimits): JsonValue {
  const captureLimits = limits ?? (isCapabilityListMethod(method) ? RESPONSE_JSON_VALUE_LIMITS : JSON_VALUE_LIMITS);
  const captured = toJsonValue(result, captureLimits);
  if (method === 'tools/call') assertCanonicalToolResult(captured);
  if (
    method !== 'resources/templates/list' ||
    captured === null ||
    Array.isArray(captured) ||
    typeof captured !== 'object' ||
    !Array.isArray(captured.resourceTemplates)
  ) {
    return captured;
  }
  captured.resourceTemplates = captured.resourceTemplates.map((template) => {
    if (
      template === null ||
      Array.isArray(template) ||
      typeof template !== 'object' ||
      typeof template.uriTemplate !== 'string'
    ) {
      return template;
    }
    try {
      new UriTemplate(template.uriTemplate);
      return template;
    } catch {
      return null;
    }
  });
  return captured;
}
