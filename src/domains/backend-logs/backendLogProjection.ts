import { warnIf } from '@src/logger/logger.js';
import { ManagedStdioStderrEvent } from '@src/transport/managedStdioStderrEvent.js';
import type { ManagedStdioStderrMetadata } from '@src/transport/managedStdioStderrMetadata.js';

import type { BackendLogBroker } from './backendLogBroker.js';
import type { BackendLogEventKind, BackendLogSource } from './backendLogTypes.js';

export function createBackendLogProjection(input: { broker: BackendLogBroker; source: BackendLogSource }) {
  return (event: ManagedStdioStderrEvent, metadata: ManagedStdioStderrMetadata): void => {
    const projected = projectManagedStderrEvent(event, metadata);
    const entry = input.broker.publish({ sourceId: input.source.id, ...projected });
    warnIf(() => ({
      message: `[${entry.displayName}] ${entry.content}`,
      meta: {
        serverName: entry.canonicalName,
        source: 'backend-stderr',
        backendLogSequence: entry.sequence,
        backendLogSourceId: entry.sourceId,
        backendLogEventKind: entry.kind,
        ...(entry.count === undefined ? {} : { count: entry.count }),
        ...(entry.truncated ? { truncated: true } : {}),
      },
    }));
  };
}

function projectManagedStderrEvent(
  event: ManagedStdioStderrEvent,
  metadata: ManagedStdioStderrMetadata,
): {
  kind: BackendLogEventKind;
  content: string;
  count?: number;
  truncated?: boolean;
} {
  if (event === ManagedStdioStderrEvent.Repeated) {
    const count = metadata.repeatCount ?? 0;
    return {
      kind: 'repeated',
      content: `Previous backend stderr line repeated ${count} times`,
      count,
    };
  }
  if (event === ManagedStdioStderrEvent.Suppressed) {
    const count = metadata.suppressedCount ?? 0;
    return {
      kind: 'suppressed',
      content: `Suppressed ${count} backend stderr lines`,
      count,
    };
  }
  return { kind: 'line', content: metadata.line ?? '', truncated: metadata.truncated };
}
