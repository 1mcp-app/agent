import type { LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import { describe, expect, it } from 'vitest';

import { beginLegacyInteractionRequest, withLegacyInteractionLease } from './legacyInteractionLease.js';

describe('adapter interaction lease', () => {
  it('prevents unscoped REST or CLI invocation from sharing a protocol owner', async () => {
    const adapter = {} as LegacySdkAdapter;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const owned = withLegacyInteractionLease(adapter, () => pending);
    expect(() => beginLegacyInteractionRequest(adapter, 'tools/call')).toThrow('interaction_capacity_exceeded');
    release();
    await owned;
    const end = beginLegacyInteractionRequest(adapter, 'tools/call');
    await expect(withLegacyInteractionLease(adapter, async () => undefined)).rejects.toThrow(
      'interaction_capacity_exceeded',
    );
    end();
    await expect(withLegacyInteractionLease(adapter, async () => undefined)).resolves.toBeUndefined();
  });

  it('admits the owner once and rejects concurrent nested invocation', async () => {
    const adapter = {} as LegacySdkAdapter;
    await withLegacyInteractionLease(adapter, async () => {
      const end = beginLegacyInteractionRequest(adapter, 'prompts/get');
      expect(() => beginLegacyInteractionRequest(adapter, 'resources/read')).toThrow('interaction_capacity_exceeded');
      end();
      beginLegacyInteractionRequest(adapter, 'resources/read')();
    });
  });
});
