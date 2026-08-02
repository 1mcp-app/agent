import { formatTemplateInstanceId } from '@src/core/server/templateIdentity.js';

import type { BackendLogCapture, BackendLogSource } from './backendLogTypes.js';

export function staticBackendLogSource(
  name: string,
  capture: BackendLogCapture = 'managed',
): BackendLogSource {
  return {
    id: `static:${name}`,
    canonicalName: name,
    displayName: name,
    kind: 'static',
    capture,
    lifecycle: 'active',
  };
}

export function templateBackendLogSource(input: {
  templateName: string;
  instanceId: string;
  capture?: BackendLogCapture;
}): BackendLogSource {
  return {
    id: `template:${input.instanceId}`,
    canonicalName: input.instanceId,
    displayName: `${input.templateName} (${formatTemplateInstanceId(input.instanceId)})`,
    kind: 'template',
    capture: input.capture ?? 'managed',
    lifecycle: 'active',
  };
}

