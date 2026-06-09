import { createHash } from 'node:crypto';

import type { ContextData } from '@src/types/context.js';

export function deriveContextSessionId(context: ContextData): string {
  const stableContext = normalizeForSessionHash({
    project: context.project,
    user: context.user,
    environment: context.environment,
    ...(context.version ? { version: context.version } : {}),
    ...(context.transport
      ? {
          transport: {
            type: context.transport.type,
            ...(context.transport.url ? { url: context.transport.url } : {}),
            ...(context.transport.client ? { client: context.transport.client } : {}),
          },
        }
      : {}),
  });
  const hash = createHash('sha256').update(JSON.stringify(stableContext)).digest('hex').slice(0, 16);
  return `rest-${hash}`;
}

export function resolveCanonicalSessionId(input: {
  context: ContextData;
  transportSessionId?: string;
  deriveSessionId?: (context: ContextData) => string;
}): string {
  return input.transportSessionId || (input.deriveSessionId ?? deriveContextSessionId)(input.context);
}

export function withCanonicalSessionId(context: ContextData, sessionId: string): ContextData {
  return context.sessionId === sessionId ? context : { ...context, sessionId };
}

function normalizeForSessionHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForSessionHash(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [key, normalizeForSessionHash(entryValue)] as const),
    );
  }

  return value;
}
