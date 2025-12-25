import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatTimestamp } from './context.js';

describe('context utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  describe('formatTimestamp', () => {
    it('should format current timestamp as ISO string', () => {
      const timestamp = formatTimestamp();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should include timezone Z suffix', () => {
      const timestamp = formatTimestamp();
      expect(timestamp).toMatch(/Z$/);
    });

    it('should be a valid date format', () => {
      const timestamp = formatTimestamp();
      const date = new Date(timestamp);
      expect(date.getTime()).not.toBeNaN();
    });

    it('should generate different timestamps on subsequent calls', () => {
      const timestamp1 = formatTimestamp();
      vi.advanceTimersByTime(1000); // Advance time by 1 second
      const timestamp2 = formatTimestamp();
      expect(timestamp1).not.toBe(timestamp2);
    });
  });
});
