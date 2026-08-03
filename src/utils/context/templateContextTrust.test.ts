import type { ContextData } from '@src/types/context.js';

import {
  createTrustedTemplateContext,
  isTrustedTemplateContext,
} from './templateContextTrust.js';

import { describe, expect, it } from 'vitest';

describe('templateContextTrust', () => {
  const context: ContextData = {
    project: { path: '/repo' },
    user: { username: 'user' },
    environment: { variables: {} },
  };

  it('only trusts contexts minted in the current process', () => {
    const trustedContext = createTrustedTemplateContext(context);

    expect(isTrustedTemplateContext(context)).toBe(false);
    expect(isTrustedTemplateContext(trustedContext)).toBe(true);
    expect(isTrustedTemplateContext(JSON.parse(JSON.stringify(trustedContext)))).toBe(false);
  });
});
