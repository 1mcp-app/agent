import { createHash } from 'crypto';

import type { ContextData } from '@src/types/context.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ContextHashOptions {
  omitWorkingDirectory?: boolean;
}

export function toCacheableContext(context: ContextData, options: ContextHashOptions = {}): JsonValue {
  const { timestamp: _timestamp, ...rest } = context;

  return sortJsonValue({
    ...rest,
    project: {
      ...rest.project,
      cwd: options.omitWorkingDirectory ? undefined : rest.project.cwd,
    },
    environment: {
      ...rest.environment,
      variables: {
        ...rest.environment?.variables,
        PWD: options.omitWorkingDirectory ? undefined : rest.environment?.variables?.PWD,
      },
    },
  }) as JsonValue;
}

export function createContextHash(context: ContextData, options?: ContextHashOptions): string {
  return createHash('sha256')
    .update(JSON.stringify(toCacheableContext(context, options)))
    .digest('hex');
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)] as const);

    return Object.fromEntries(sortedEntries);
  }

  return value;
}
