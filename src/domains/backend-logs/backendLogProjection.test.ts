import { writeBackendDiagnostic } from '@src/logger/logger.js';
import { ManagedStdioStderrEvent } from '@src/transport/managedStdioStderrEvent.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendLogBroker } from './backendLogBroker.js';
import { createBackendLogProjection } from './backendLogProjection.js';
import { staticBackendLogSource } from './backendLogSource.js';

vi.mock('@src/logger/logger.js', () => ({ writeBackendDiagnostic: vi.fn() }));

describe('createBackendLogProjection', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [
      ManagedStdioStderrEvent.Line,
      { line: 'api_key=abc', truncated: true },
      '[filesystem] api_key=[REDACTED]',
      'api_key=[REDACTED]',
      'line',
      true,
      undefined,
    ],
    [
      ManagedStdioStderrEvent.Repeated,
      { repeatCount: 3 },
      '[filesystem] Previous backend stderr line repeated 3 times',
      'Previous backend stderr line repeated 3 times',
      'repeated',
      false,
      3,
    ],
    [
      ManagedStdioStderrEvent.Suppressed,
      { suppressedCount: 4 },
      '[filesystem] Suppressed 4 backend stderr lines',
      'Suppressed 4 backend stderr lines',
      'suppressed',
      false,
      4,
    ],
  ] as const)('prefixes and structures %s output', (event, facts, _message, content, kind, truncated, count) => {
    const broker = new BackendLogBroker();
    const source = staticBackendLogSource('filesystem');
    broker.registerSource(source);
    const project = createBackendLogProjection({ broker, source });

    project(event, { serverName: 'filesystem', source: 'backend-stderr', ...facts });

    expect(writeBackendDiagnostic).toHaveBeenCalledOnce();
    expect(vi.mocked(writeBackendDiagnostic).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        content,
        canonicalName: 'filesystem',
        sourceId: 'static:filesystem',
        kind,
      }),
    );
    expect(broker.snapshot().entries).toContainEqual(
      expect.objectContaining({ content, kind, truncated, ...(count === undefined ? {} : { count }) }),
    );
  });
});
