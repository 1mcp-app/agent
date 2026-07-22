import { describe, expect, it } from 'vitest';

import { createInitialState } from './adminConsoleState';
import { pollingDelayForVisibility, shouldPollConsole } from './polling';

describe('admin console polling', () => {
  it('uses short visible polling and reduced hidden-tab polling', () => {
    expect(pollingDelayForVisibility('visible')).toBe(5000);
    expect(pollingDelayForVisibility('hidden')).toBe(60000);
    expect(pollingDelayForVisibility('prerender')).toBe(60000);
  });

  it('polls only while an admin session is active', () => {
    expect(shouldPollConsole(createInitialState())).toBe(false);
    expect(
      shouldPollConsole({
        ...createInitialState(),
        view: 'console',
        session: {
          authenticated: true,
          account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
          csrfToken: 'csrf_123',
          expiresAt: '2026-07-07T01:00:00.000Z',
        },
      }),
    ).toBe(true);
  });
});
