import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

import { JSON_VALUE_LIMITS, type JsonValue, type JsonValueLimits, toJsonValue } from '@src/sdk/contracts/index.js';

import { assertCanonicalToolResult } from './schemaProjection.js';

/** Keep malformed template syntax local to one catalog source capability. */
export function captureCapabilityListResult(
  method: string,
  result: unknown,
  limits: JsonValueLimits = JSON_VALUE_LIMITS,
): JsonValue {
  const captured = toJsonValue(result, limits);
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
