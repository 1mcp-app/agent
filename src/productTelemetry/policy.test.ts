import { describe, expect, it } from 'vitest';

import { collectionEnabled, parseEnvironmentBoolean } from './policy.js';

describe('Product Usage Telemetry policy', () => {
  it('defaults on but every explicit disable dominates process enablement', () => {
    expect(collectionEnabled({ testSuppressed: false, ci: false })).toBe(true);
    for (const hardDisable of [
      { testSuppressed: true },
      { doNotTrack: true },
      { processEnabled: false },
      { storedEnabled: false },
      { ci: true },
    ]) {
      expect(collectionEnabled({ testSuppressed: false, ci: false, processEnabled: true, ...hardDisable })).toBe(false);
    }
    expect(collectionEnabled({ testSuppressed: false, ci: true, ciEnabled: true })).toBe(true);
  });
  it('normalizes explicit standard boolean encodings and rejects unknown values', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes']) expect(parseEnvironmentBoolean(value)).toBe(true);
    for (const value of ['0', 'false', 'FALSE', 'no', '', undefined])
      expect(parseEnvironmentBoolean(value)).toBe(false);
    expect(() => parseEnvironmentBoolean('maybe')).toThrow('boolean');
  });
});
