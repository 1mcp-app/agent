import { describe, expect, it, vi } from 'vitest';

import { assertInteractionRoute, withDerivedInteractionRoute, withInteractionRoute } from './interactionRoute.js';

describe('withDerivedInteractionRoute', () => {
  const original = {};
  const child = {};

  it('runs an unpinned request on the private peer like its shared source', async () => {
    const effect = vi.fn();

    await withDerivedInteractionRoute(original, child, async () => {
      assertInteractionRoute(child, 'tools/call', { name: 'echo' });
      effect();
    });

    expect(effect).toHaveBeenCalledOnce();
  });

  it('moves a pinned route to the private peer', async () => {
    const effect = vi.fn();
    const pin = { adapter: original, method: 'tools/call', identity: 'echo', isCurrent: () => true };

    await withInteractionRoute(pin, () =>
      withDerivedInteractionRoute(original, child, async () => {
        assertInteractionRoute(child, 'tools/call', { name: 'echo' });
        expect(() => assertInteractionRoute(original, 'tools/call', { name: 'echo' })).toThrow(
          'Interaction route is no longer available',
        );
        effect();
      }),
    );

    expect(effect).toHaveBeenCalledOnce();
  });

  it.each([
    ['a different source', { adapter: {}, isCurrent: () => true }],
    ['a stale route', { adapter: original, isCurrent: () => false }],
  ])('refuses a pin for %s before running the operation', async (_label, pinned) => {
    const effect = vi.fn();
    const pin = { method: 'tools/call', identity: 'echo', ...pinned };

    await expect(
      withInteractionRoute(pin, async () => withDerivedInteractionRoute(original, child, async () => effect())),
    ).rejects.toMatchObject({ code: 'interaction_lost' });
    expect(effect).not.toHaveBeenCalled();
  });
});
