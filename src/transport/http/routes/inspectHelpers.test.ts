import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { ClientStatus } from '@src/core/types/client.js';

import { describe, expect, it } from 'vitest';

import { deriveServerState } from './inspectHelpers.js';

describe('deriveServerState', () => {
  it('keeps a tracked loading state authoritative over a stale connected client', () => {
    expect(
      deriveServerState(
        'connected',
        true,
        { status: ClientStatus.Connected } as never,
        { name: 'slow', state: LoadingState.Loading, retryCount: 0 },
      ),
    ).toEqual({ status: 'loading', available: false });
  });

  it('uses the connected client once the loading tracker is ready', () => {
    expect(
      deriveServerState(
        undefined,
        undefined,
        { status: ClientStatus.Connected } as never,
        { name: 'ready', state: LoadingState.Ready, retryCount: 0 },
      ),
    ).toEqual({ status: 'connected', available: true });
  });
});
