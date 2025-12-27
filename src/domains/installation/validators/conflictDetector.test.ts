import { describe, expect, it } from 'vitest';

import { checkNameConflict, generateAlternativeNames, validateNoConflict } from './conflictDetector.js';

describe('conflictDetector', () => {
  describe('checkNameConflict', () => {
    it('should detect conflict when name exists', () => {
      const result = checkNameConflict('test-server', ['test-server', 'other-server']);

      expect(result.hasConflict).toBe(true);
      expect(result.conflictingName).toBe('test-server');
    });

    it('should not detect conflict when name is unique', () => {
      const result = checkNameConflict('new-server', ['test-server', 'other-server']);

      expect(result.hasConflict).toBe(false);
      expect(result.conflictingName).toBeUndefined();
    });

    it('should handle empty existing names', () => {
      const result = checkNameConflict('test-server', []);

      expect(result.hasConflict).toBe(false);
    });

    it('should be case-sensitive', () => {
      const result = checkNameConflict('Test-Server', ['test-server']);

      expect(result.hasConflict).toBe(false);
    });
  });

  describe('generateAlternativeNames', () => {
    it('should generate alternative names with incrementing suffixes', () => {
      const alternatives = generateAlternativeNames('test', ['other'], 3);

      expect(alternatives).toHaveLength(3);
      expect(alternatives[0]).toBe('test_1');
      expect(alternatives[1]).toBe('test_2');
      expect(alternatives[2]).toBe('test_3');
    });

    it('should skip conflicting alternatives', () => {
      const alternatives = generateAlternativeNames('test', ['test_1', 'test_2'], 3);

      expect(alternatives).toHaveLength(3);
      expect(alternatives[0]).toBe('test_3');
      expect(alternatives[1]).toBe('test_4');
      expect(alternatives[2]).toBe('test_5');
    });

    it('should generate requested number of alternatives', () => {
      expect(generateAlternativeNames('test', [], 1)).toHaveLength(1);
      expect(generateAlternativeNames('test', [], 5)).toHaveLength(5);
    });

    it('should handle names with existing numbers', () => {
      const alternatives = generateAlternativeNames('test_1', ['other'], 2);

      expect(alternatives[0]).toBe('test_1_1');
      expect(alternatives[1]).toBe('test_1_2');
    });
  });

  describe('validateNoConflict', () => {
    it('should validate when name does not conflict', () => {
      const result = validateNoConflict('new-server', ['existing-server']);

      expect(result.valid).toBe(true);
      // With discriminated union, valid: true means no error property
      expect(result).toEqual({ valid: true });
    });

    it('should invalidate when name conflicts', () => {
      const result = validateNoConflict('test-server', ['test-server', 'other']);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('test-server');
        expect(result.error).toContain('already exists');
      }
    });

    it('should handle empty existing names', () => {
      const result = validateNoConflict('test-server', []);

      expect(result.valid).toBe(true);
    });
  });
});
