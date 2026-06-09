import { describe, expect, it, vi } from 'vitest';

import { LoadingState, LoadingStateEvent, LoadingStateTracker } from './loadingStateTracker.js';

describe('LoadingStateTracker.registerServer', () => {
  it('adds a single server at runtime without resetting other servers', () => {
    const tracker = new LoadingStateTracker();
    tracker.startLoading(['boot-server']);
    tracker.updateServerState('boot-server', LoadingState.Ready);

    // Hot-reload add: a new server appears after boot.
    tracker.registerServer('hot-server');

    expect(tracker.getServerState('hot-server')).toBeDefined();
    expect(tracker.getServerState('hot-server')!.state).toBe(LoadingState.Pending);
    // The boot server's state is untouched.
    expect(tracker.getServerState('boot-server')!.state).toBe(LoadingState.Ready);
    expect(tracker.getSummary().totalServers).toBe(2);
  });

  it('is a no-op if the server is already tracked (preserves its state)', () => {
    const tracker = new LoadingStateTracker();
    tracker.startLoading(['s']);
    tracker.updateServerState('s', LoadingState.AwaitingOAuth);

    tracker.registerServer('s'); // should not reset to Pending

    expect(tracker.getServerState('s')!.state).toBe(LoadingState.AwaitingOAuth);
    expect(tracker.getSummary().totalServers).toBe(1);
  });

  it('makes the server visible in the awaitingOAuth summary after it transitions', () => {
    // Reproduces the fix: a hot-reload-added server that needs OAuth must show
    // up in /health/mcp (summary.awaitingOAuth), not be invisible.
    const tracker = new LoadingStateTracker();
    tracker.registerServer('server1');
    tracker.updateServerState('server1', LoadingState.AwaitingOAuth);

    expect(tracker.getSummary().awaitingOAuth).toBe(1);
    expect(tracker.getServerState('server1')!.state).toBe(LoadingState.AwaitingOAuth);
  });
});

describe('LoadingStateTracker.removeServer', () => {
  it('removes a tracked server so it no longer appears in state or summary', () => {
    const tracker = new LoadingStateTracker();
    tracker.startLoading(['alpha', 'beta']);

    // alpha gets stuck awaiting OAuth (the real-world ghost scenario).
    tracker.updateServerState('alpha', LoadingState.AwaitingOAuth);
    tracker.updateServerState('beta', LoadingState.Ready);

    expect(tracker.getServerState('alpha')).toBeDefined();
    expect(tracker.getSummary().awaitingOAuth).toBe(1);

    const removed = tracker.removeServer('alpha');

    expect(removed).toBe(true);
    expect(tracker.getServerState('alpha')).toBeUndefined();
    expect(tracker.getAllServerStates().has('alpha')).toBe(false);
    // The ghost is gone from the summary that /health/mcp reports.
    expect(tracker.getSummary().awaitingOAuth).toBe(0);
    expect(tracker.getSummary().totalServers).toBe(1);
    // Unrelated servers are untouched.
    expect(tracker.getServerState('beta')).toBeDefined();
  });

  it('returns false and is a no-op when the server is not tracked', () => {
    const tracker = new LoadingStateTracker();
    tracker.startLoading(['alpha']);

    const removed = tracker.removeServer('does-not-exist');

    expect(removed).toBe(false);
    expect(tracker.getSummary().totalServers).toBe(1);
  });

  it('emits a progress update when a tracked server is removed', () => {
    const tracker = new LoadingStateTracker();
    tracker.startLoading(['alpha']);
    tracker.updateServerState('alpha', LoadingState.AwaitingOAuth);

    const onProgress = vi.fn();
    tracker.on(LoadingStateEvent.LoadingProgress, onProgress);

    tracker.removeServer('alpha');

    expect(onProgress).toHaveBeenCalled();
  });
});
