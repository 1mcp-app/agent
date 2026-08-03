import { act, renderHook, waitFor } from '@testing-library/react';

import { describe, expect, it, vi } from 'vitest';

import type { AdminApiClient, BackendLogSnapshot } from '../api/adminApi';
import { useBackendLogs } from './useBackendLogs';

const snapshot: BackendLogSnapshot = {
  sequence: 2,
  sources: [
    {
      id: 'static:filesystem',
      canonicalName: 'filesystem',
      displayName: 'filesystem',
      kind: 'static',
      capture: 'managed',
      lifecycle: 'active',
    },
    {
      id: 'static:search',
      canonicalName: 'search',
      displayName: 'search',
      kind: 'static',
      capture: 'managed',
      lifecycle: 'active',
    },
  ],
  entries: [
    {
      sequence: 1,
      timestamp: '2026-08-02T00:00:00.000Z',
      sourceId: 'static:filesystem',
      canonicalName: 'filesystem',
      displayName: 'filesystem',
      sourceKind: 'static',
      kind: 'line',
      content: 'ready',
      truncated: false,
    },
    {
      sequence: 2,
      timestamp: '2026-08-02T00:00:01.000Z',
      sourceId: 'static:search',
      canonicalName: 'search',
      displayName: 'search',
      sourceKind: 'static',
      kind: 'line',
      content: 'indexed',
      truncated: false,
    },
  ],
};

describe('useBackendLogs', () => {
  it('uses one stream across tab changes and keeps inactive entries as unread summaries', async () => {
    let handlers: Parameters<AdminApiClient['openBackendLogStream']>[0] | undefined;
    const close = vi.fn();
    const api = {
      openBackendLogStream: vi.fn((nextHandlers) => {
        handlers = nextHandlers;
        return close;
      }),
      getBackendLogSnapshot: vi.fn().mockResolvedValue(snapshot),
    } as unknown as AdminApiClient;
    const { result, unmount } = renderHook(() =>
      useBackendLogs({ api, active: true, authenticated: true, onUnauthenticated: vi.fn() }),
    );

    act(() => handlers!.onSnapshot(snapshot));
    expect(result.current.selectedSourceId).toBe('static:filesystem');
    expect(result.current.entries.map((entry) => entry.content)).toEqual(['ready']);
    expect(result.current.unread).toEqual({ 'static:search': 1 });

    act(() => handlers!.onEntry({ ...snapshot.entries[1], sequence: 3, content: 'more' }));
    expect(result.current.entries.map((entry) => entry.content)).toEqual(['ready']);
    expect(result.current.unread['static:search']).toBe(2);
    expect(result.current.cursors['static:search']).toBe(3);

    await act(async () => result.current.select('static:search'));
    expect(result.current.entries.map((entry) => entry.content)).toEqual(['indexed']);
    expect(api.getBackendLogSnapshot).toHaveBeenCalledWith('static:search');
    expect(api.openBackendLogStream).toHaveBeenCalledOnce();

    act(() => handlers!.onGap({ sequence: 3, sources: [snapshot.sources[1]], entries: [] }));
    expect(result.current.selectedSourceId).toBe('static:search');
    expect(result.current.entries).toEqual([]);

    unmount();
    expect(close).toHaveBeenCalledOnce();
  });

  it('treats source catalogs as authoritative and loads a replacement for a removed selection', async () => {
    let handlers: Parameters<AdminApiClient['openBackendLogStream']>[0] | undefined;
    const api = {
      openBackendLogStream: vi.fn((nextHandlers) => {
        handlers = nextHandlers;
        return vi.fn();
      }),
      getBackendLogSnapshot: vi.fn().mockResolvedValue(snapshot),
    } as unknown as AdminApiClient;
    const { result } = renderHook(() =>
      useBackendLogs({ api, active: true, authenticated: true, onUnauthenticated: vi.fn() }),
    );

    act(() => handlers!.onSnapshot(snapshot));
    expect(result.current.cursors).toEqual({ 'static:filesystem': 1, 'static:search': 2 });

    act(() => handlers!.onSources([snapshot.sources[1]]));

    await waitFor(() => expect(result.current.selectionLoading).toBe(false));
    expect(result.current.selectedSourceId).toBe('static:search');
    expect(result.current.entries.map((entry) => entry.content)).toEqual(['indexed']);
    expect(result.current.unread).not.toHaveProperty('static:filesystem');
    expect(result.current.cursors).not.toHaveProperty('static:filesystem');
  });

  it('selects the first live source and reports retained-history load failures', async () => {
    let handlers: Parameters<AdminApiClient['openBackendLogStream']>[0] | undefined;
    const api = {
      openBackendLogStream: vi.fn((nextHandlers) => {
        handlers = nextHandlers;
        return vi.fn();
      }),
      getBackendLogSnapshot: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as AdminApiClient;
    const { result } = renderHook(() =>
      useBackendLogs({ api, active: true, authenticated: true, onUnauthenticated: vi.fn() }),
    );

    act(() => handlers!.onSnapshot({ sequence: 0, sources: [], entries: [] }));
    act(() =>
      handlers!.onSourceUpdate({ sourceId: snapshot.sources[1].id, source: snapshot.sources[1], removed: false }),
    );

    await waitFor(() => expect(result.current.selectionLoading).toBe(false));
    expect(result.current.selectedSourceId).toBe('static:search');
    expect(result.current.selectionError).toBe(
      'Failed to load retained backend logs. Live entries will continue to appear.',
    );
  });
});
