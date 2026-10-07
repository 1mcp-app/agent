import { describe, expect, it } from 'vitest';

import {
  bindResourceRouteOwner,
  createResourceRouteOwner,
  getResourceRouteOwner,
  isResourceRouteOwnerActive,
  revokeResourceRouteOwner,
} from './capabilityVisibility.js';

describe('trusted resource route owners', () => {
  it('keeps ownership in an internal context association that JSON cannot recreate', () => {
    const owner = createResourceRouteOwner();
    const context = { sessionId: 'private-bridge' };
    bindResourceRouteOwner(context, owner);
    expect(getResourceRouteOwner(context)).toBe(owner);
    expect(getResourceRouteOwner(JSON.parse(JSON.stringify(context)))).toBeUndefined();
    expect(isResourceRouteOwnerActive(JSON.parse(JSON.stringify(owner)))).toBe(false);
    expect(createResourceRouteOwner()).not.toBe(owner);
    expect(JSON.stringify(context)).toBe('{"sessionId":"private-bridge"}');
  });

  it('revokes the owner without converting its context to legacy ownership', () => {
    const owner = createResourceRouteOwner();
    const context = {};
    bindResourceRouteOwner(context, owner);
    revokeResourceRouteOwner(owner);
    expect(getResourceRouteOwner(context)).toBe(owner);
    expect(isResourceRouteOwnerActive(owner)).toBe(false);
    expect(() => bindResourceRouteOwner({}, owner)).toThrow('unavailable');
  });
});
