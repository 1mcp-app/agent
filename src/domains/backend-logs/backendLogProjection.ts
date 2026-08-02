import type { ManagedStdioStderrEvent } from '@src/transport/managedStdioStderrEvent.js';
import type { ManagedStdioStderrMetadata } from '@src/transport/managedStdioStderrMetadata.js';
import logger from '@src/logger/logger.js';

import type { BackendLogBroker } from './backendLogBroker.js';
import type { BackendLogEventKind, BackendLogSource } from './backendLogTypes.js';

export function createBackendLogProjection(input: { broker: BackendLogBroker; source: BackendLogSource }) {
  input.broker.registerSource(input.source);
  return (_event: ManagedStdioStderrEvent, metadata: ManagedStdioStderrMetadata): void => {
    const event = projectManagedStderrEvent(metadata);
    const entry = input.broker.publish({ sourceId: input.source.id, ...event });
    logger.warn(`[${entry.displayName}] ${entry.content}`, {
      serverName: entry.canonicalName,
      source: 'backend-stderr',
      backendLogSequence: entry.sequence,
      backendLogSourceId: entry.sourceId,
      backendLogEventKind: entry.kind,
      ...(entry.count === undefined ? {} : { count: entry.count }),
      ...(entry.truncated ? { truncated: true } : {}),
    });
  };
}

function projectManagedStderrEvent(metadata: ManagedStdioStderrMetadata): {
  kind: BackendLogEventKind;
  content: string;
  count?: number;
  truncated?: boolean;
} {
  if (metadata.repeatCount !== undefined) {
    return {
      kind: 'repeated',
      content: `Previous backend stderr line repeated ${metadata.repeatCount} times`,
      count: metadata.repeatCount,
    };
  }
  if (metadata.suppressedCount !== undefined) {
    return {
      kind: 'suppressed',
      content: `Suppressed ${metadata.suppressedCount} backend stderr lines`,
      count: metadata.suppressedCount,
    };
  }
  return { kind: 'line', content: metadata.line ?? '', truncated: metadata.truncated };
}

