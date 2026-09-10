import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

import { type JsonValue, toJsonValue } from '@src/sdk/contracts/index.js';

/** Keep malformed template syntax local to one catalog source capability. */
export function captureCapabilityListResult(method: string, result: unknown): JsonValue {
  const captured = toJsonValue(result);
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
