import { describe, expect, it, vi } from 'vitest';

import { BackendLogBroker } from './backendLogBroker.js';
import { sanitizeBackendLogContent } from './backendLogSanitizer.js';

const staticSource = {
  id: 'static:filesystem',
  canonicalName: 'filesystem',
  displayName: 'filesystem',
  kind: 'static' as const,
  capture: 'managed' as const,
  lifecycle: 'active' as const,
};

describe('BackendLogBroker', () => {
  it('sanitizes secrets and terminal controls before retaining or publishing content', () => {
    const broker = new BackendLogBroker();
    const received = vi.fn();
    broker.registerSource(staticSource);
    broker.subscribe({ onEvent: received });

    const entry = broker.publish({
      sourceId: staticSource.id,
      kind: 'line',
      content: '\u001b[31mAuthorization: Bearer top-secret\u001b[0m api_key=also-secret',
    });

    expect(entry.content).toBe('Authorization: Bearer [REDACTED] api_key=[REDACTED]');
    expect(broker.snapshot().entries).toEqual([entry]);
    expect(received).not.toHaveBeenCalled();
  });

  it('evicts oldest entries under the per-source and global byte limits', () => {
    const broker = new BackendLogBroker({ perSourceBytes: 1, globalBytes: 2, measureEntry: () => 1 });
    const secondSource = { ...staticSource, id: 'static:search', canonicalName: 'search', displayName: 'search' };
    broker.registerSource(staticSource);
    broker.registerSource(secondSource);

    const first = broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'a'.repeat(120) });
    const second = broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'b'.repeat(120) });
    const third = broker.publish({ sourceId: secondSource.id, kind: 'line', content: 'c'.repeat(120) });

    const snapshot = broker.snapshot();
    expect(snapshot.entries).not.toContainEqual(first);
    expect(snapshot.entries).toContainEqual(second);
    expect(snapshot.entries).toContainEqual(third);
    expect(snapshot.entries.map((entry) => entry.sequence)).toEqual(
      [...snapshot.entries.map((entry) => entry.sequence)].sort((left, right) => left - right),
    );
  });

  it('keeps static and template lifecycle identities separate and removes ended sources after eviction', () => {
    const broker = new BackendLogBroker({ perSourceBytes: 2, globalBytes: 1, measureEntry: () => 1 });
    const templateSource = {
      id: 'template:0123456789abcdef',
      canonicalName: 'template:0123456789abcdef',
      displayName: 'search (0123456789ab)',
      kind: 'template' as const,
      capture: 'managed' as const,
      lifecycle: 'active' as const,
    };
    broker.registerSource(staticSource);
    broker.registerSource(templateSource);
    broker.publish({ sourceId: templateSource.id, kind: 'line', content: 'template ended' });
    broker.updateSource(templateSource.id, { lifecycle: 'ended' });

    expect(broker.snapshot().sources).toContainEqual(expect.objectContaining({ id: templateSource.id, lifecycle: 'ended' }));

    broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'x'.repeat(260) });
    expect(broker.snapshot().sources.map((source) => source.id)).not.toContain(templateSource.id);
  });

  it('replays retained entries and reports a gap for an evicted cursor', () => {
    const broker = new BackendLogBroker({ perSourceBytes: 1, globalBytes: 1, measureEntry: () => 1 });
    broker.registerSource(staticSource);
    const first = broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'a'.repeat(120) });
    const second = broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'b'.repeat(120) });

    expect(broker.replayAfter(second.sequence)).toEqual({ kind: 'replay', entries: [] });
    expect(broker.replayAfter(first.sequence - 1)).toEqual(
      expect.objectContaining({ kind: 'gap', snapshot: expect.objectContaining({ entries: [second] }) }),
    );
  });

  it('disconnects a slow subscriber without delaying publication', async () => {
    const broker = new BackendLogBroker({ subscriberQueueBytes: 180 });
    const disconnected = vi.fn();
    broker.registerSource(staticSource);
    broker.subscribe({ onEvent: vi.fn(), onDisconnect: disconnected });

    const publishResult = broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'x'.repeat(300) });
    expect(publishResult.sequence).toBe(1);
    expect(disconnected).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disconnected).toHaveBeenCalledWith('slow-subscriber');
  });

  it('reports a gap when all entries after a cursor have been evicted', () => {
    const broker = new BackendLogBroker({ perSourceBytes: 0, globalBytes: 0, measureEntry: () => 1 });
    broker.registerSource(staticSource);
    broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'gone' });

    expect(broker.replayAfter(0)).toEqual(
      expect.objectContaining({ kind: 'gap', snapshot: expect.objectContaining({ entries: [] }) }),
    );
  });
});

describe('sanitizeBackendLogContent', () => {
  it.each([
    ['password=hunter2', 'password=[REDACTED]'],
    ['https://user:secret@example.com/path?code=oauth-code', 'https://user:[REDACTED]@example.com/path?code=[REDACTED]'],
    ['client_secret: abc123', 'client_secret: [REDACTED]'],
  ])('redacts %s', (input, expected) => {
    expect(sanitizeBackendLogContent(input)).toBe(expected);
  });
});
