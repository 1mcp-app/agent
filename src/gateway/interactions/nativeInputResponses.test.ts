import type { LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import { describe, expect, it } from 'vitest';

import {
  captureNativeInitialInputResponses,
  runWithNativeInitialInputResponses,
  takeNativeInitialInputResponses,
  withSelectedNativeInputResponses,
} from './nativeInputResponses.js';

const modern = { protocol: { era: 'modern' } } as LegacySdkAdapter;
describe('initial native driver material ownership', () => {
  it('detaches exact unknown bare response keys and consumes only the selected execution once', async () => {
    const inputs = { known: { action: 'accept', content: { value: 1 } }, extra: { future: true } };
    const scope = captureNativeInitialInputResponses('tools/call', { name: 'public' }, inputs);
    inputs.known.content.value = 2;
    await runWithNativeInitialInputResponses(scope, async () => {
      await withSelectedNativeInputResponses('other', 'tools/call', modern, 'raw', async () => {
        expect(takeNativeInitialInputResponses(modern, 'tools/call', { name: 'raw' })).toBeUndefined();
      });
      await withSelectedNativeInputResponses('public', 'tools/call', modern, 'raw', async () => {
        expect(takeNativeInitialInputResponses({}, 'tools/call', { name: 'raw' })).toBeUndefined();
        expect(takeNativeInitialInputResponses(modern, 'tools/list', {})).toBeUndefined();
        expect(takeNativeInitialInputResponses(modern, 'tools/call', { name: 'other' })).toBeUndefined();
        await withSelectedNativeInputResponses('public', 'tools/call', modern, 'raw', async () => {
          expect(takeNativeInitialInputResponses(modern, 'tools/call', { name: 'raw' })).toBeUndefined();
        });
        const actual = takeNativeInitialInputResponses(modern, 'tools/call', { name: 'raw' });
        expect(actual).toEqual({ known: { action: 'accept', content: { value: 1 } }, extra: { future: true } });
        expect(Object.isFrozen(actual)).toBe(true);
        expect(Object.isFrozen(actual?.known)).toBe(true);
        expect(takeNativeInitialInputResponses(modern, 'tools/call', { name: 'raw' })).toBeUndefined();
      });
    });
  });

  it.each([
    null,
    [],
    1,
    'invalid',
    new Proxy({}, {}),
    { huge: 'x'.repeat(1_048_576) },
    {
      get unsafe() {
        throw new Error('not read');
      },
    },
  ])('rejects invalid or unbounded records before execution', (value) => {
    expect(() => captureNativeInitialInputResponses('tools/call', { name: 'public' }, value)).toThrow(
      'Initial input responses are invalid',
    );
  });

  it('never attaches driver fields to negotiated legacy or internal calls without a selected source', async () => {
    const scope = captureNativeInitialInputResponses('tools/call', { name: 'public' }, {});
    await runWithNativeInitialInputResponses(scope, async () => {
      expect(takeNativeInitialInputResponses(modern, 'tools/call', { name: 'raw' })).toBeUndefined();
      await withSelectedNativeInputResponses(
        'public',
        'tools/call',
        { protocol: { era: 'legacy' } } as LegacySdkAdapter,
        'raw',
        async () => {
          expect(takeNativeInitialInputResponses(modern, 'tools/call', { name: 'raw' })).toBeUndefined();
        },
      );
    });
  });

  it('keeps concurrent initial records independent', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runWithNativeInitialInputResponses(
      captureNativeInitialInputResponses('tools/call', { name: 'first' }, { first: {} }),
      () =>
        withSelectedNativeInputResponses('first', 'tools/call', modern, 'raw-first', async () => {
          await pending;
          expect(takeNativeInitialInputResponses(modern, 'tools/call', { name: 'raw-first' })).toEqual({ first: {} });
        }),
    );
    await runWithNativeInitialInputResponses(
      captureNativeInitialInputResponses('tools/call', { name: 'second' }, { second: {} }),
      () =>
        withSelectedNativeInputResponses('second', 'tools/call', modern, 'raw-second', async () => {
          expect(takeNativeInitialInputResponses(modern, 'tools/call', { name: 'raw-second' })).toEqual({ second: {} });
        }),
    );
    release();
    await first;
  });
});
