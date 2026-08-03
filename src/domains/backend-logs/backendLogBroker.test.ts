import { describe, expect, it, vi } from 'vitest';

import { BackendLogBroker } from './backendLogBroker.js';
import { sanitizeBackendLogContent } from './backendLogSanitizer.js';
import { staticBackendLogSource, templateBackendLogSource } from './backendLogSource.js';

const staticSource = staticBackendLogSource('filesystem');
const templateSource = templateBackendLogSource({ templateName: 'search', instanceId: '0123456789abcdef' });

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
    broker.registerSource(staticSource);
    broker.registerSource(templateSource);
    broker.publish({ sourceId: templateSource.id, kind: 'line', content: 'template ended' });
    broker.updateSource(templateSource.id, { lifecycle: 'ended' });

    expect(broker.snapshot().sources).toContainEqual(
      expect.objectContaining({ id: templateSource.id, lifecycle: 'ended' }),
    );

    broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'x'.repeat(260) });
    expect(broker.snapshot().sources.map((source) => source.id)).not.toContain(templateSource.id);
  });

  it('keeps an ended static source after its retained history is evicted', () => {
    const broker = new BackendLogBroker({ perSourceBytes: 0, globalBytes: 0, measureEntry: () => 1 });
    broker.registerSource(staticSource);
    broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'gone' });

    broker.updateSource(staticSource.id, { lifecycle: 'ended' });

    expect(broker.snapshot().sources).toContainEqual(
      expect.objectContaining({ id: staticSource.id, lifecycle: 'ended' }),
    );
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

  it('reports a gap when a cursor is ahead of the current broker generation', () => {
    const broker = new BackendLogBroker();
    broker.registerSource(staticSource);
    const entry = broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'current generation' });

    expect(broker.replayAfter(entry.sequence + 10)).toEqual({ kind: 'gap', snapshot: broker.snapshot() });
  });

  it('filters snapshot entries by source without dropping the source catalog', () => {
    const broker = new BackendLogBroker();
    const secondSource = staticBackendLogSource('search');
    broker.registerSource(staticSource);
    broker.registerSource(secondSource);
    const filesystemEntry = broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'filesystem' });
    broker.publish({ sourceId: secondSource.id, kind: 'line', content: 'search' });

    expect(broker.snapshot(staticSource.id)).toEqual({
      sequence: 2,
      sources: [staticSource, secondSource],
      entries: [filesystemEntry],
    });
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

  it('isolates subscriber callback failures and disconnects subscribers when cleared', async () => {
    const broker = new BackendLogBroker();
    const failed = vi.fn(() => {
      throw new Error('subscriber failed');
    });
    const failedAfter = vi.fn();
    const disconnected = vi.fn();
    broker.registerSource(staticSource);
    broker.subscribe({ onEvent: failed });
    broker.subscribe({ onEvent: failedAfter, onDisconnect: disconnected });

    broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'first' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'second' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(failed).toHaveBeenCalledOnce();
    expect(failedAfter).toHaveBeenCalledTimes(2);
    broker.clear();
    expect(disconnected).toHaveBeenCalledWith('broker-reset');
  });

  it('reports a gap when all entries after a cursor have been evicted', () => {
    const broker = new BackendLogBroker({ perSourceBytes: 0, globalBytes: 0, measureEntry: () => 1 });
    broker.registerSource(staticSource);
    broker.publish({ sourceId: staticSource.id, kind: 'line', content: 'gone' });

    expect(broker.replayAfter(0)).toEqual(
      expect.objectContaining({ kind: 'gap', snapshot: expect.objectContaining({ entries: [] }) }),
    );
  });

  it('publishes source lifecycle and removal updates to active subscribers', async () => {
    const broker = new BackendLogBroker({ perSourceBytes: 0, globalBytes: 0, measureEntry: () => 1 });
    const updates = vi.fn();
    broker.subscribe({ onEvent: vi.fn(), onSourceUpdate: updates });

    broker.registerSource(templateSource);
    broker.publish({ sourceId: templateSource.id, kind: 'line', content: 'gone' });
    broker.updateSource(templateSource.id, { lifecycle: 'ended' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(updates).toHaveBeenCalledWith(expect.objectContaining({ sourceId: templateSource.id, removed: false }));
    expect(updates).toHaveBeenCalledWith({ sourceId: templateSource.id, removed: true });
  });
});

describe('sanitizeBackendLogContent', () => {
  it.each([
    ['password=hunter2', 'password=[REDACTED]'],
    [
      'https://user:secret@example.com/path?code=oauth-code',
      'https://user:[REDACTED]@example.com/path?code=oauth-code',
    ],
    ['client_secret: abc123', 'client_secret: [REDACTED]'],
    ['Bearer standalone-secret', 'Bearer [REDACTED]'],
    [
      'https://example.test/callback?token=url-secret&safe=yes',
      'https://example.test/callback?token=[REDACTED]&safe=yes',
    ],
    ['process exited with code=2 and status code: 500', 'process exited with code=2 and status code: 500'],
  ])('redacts %s', (input, expected) => {
    expect(sanitizeBackendLogContent(input)).toBe(expected);
  });
});
