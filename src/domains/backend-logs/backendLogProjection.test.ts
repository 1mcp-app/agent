import logger from '@src/logger/logger.js';
import { ManagedStdioStderrEvent } from '@src/transport/managedStdioStderrEvent.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendLogBroker } from './backendLogBroker.js';
import { createBackendLogProjection } from './backendLogProjection.js';
import { staticBackendLogSource } from './backendLogSource.js';

vi.mock('@src/logger/logger.js', () => ({ default: { warn: vi.fn() } }));

describe('createBackendLogProjection', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [ManagedStdioStderrEvent.Line, { line: 'api_key=abc', truncated: true }, '[filesystem] api_key=[REDACTED]', 'line'],
    [ManagedStdioStderrEvent.Repeated, { repeatCount: 3 }, '[filesystem] Previous backend stderr line repeated 3 times', 'repeated'],
    [ManagedStdioStderrEvent.Suppressed, { suppressedCount: 4 }, '[filesystem] Suppressed 4 backend stderr lines', 'suppressed'],
  ] as const)('prefixes and structures %s output', (event, facts, message, kind) => {
    const broker = new BackendLogBroker();
    const project = createBackendLogProjection({ broker, source: staticBackendLogSource('filesystem') });

    project(event, { serverName: 'filesystem', source: 'backend-stderr', ...facts });

    expect(logger.warn).toHaveBeenCalledWith(message, expect.objectContaining({
      serverName: 'filesystem',
      backendLogEventKind: kind,
      backendLogSourceId: 'static:filesystem',
    }));
    expect(broker.snapshot().entries).toContainEqual(expect.objectContaining({ content: message.slice(13), kind }));
  });
});
