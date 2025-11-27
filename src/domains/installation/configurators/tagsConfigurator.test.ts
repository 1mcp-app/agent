import { describe, expect, it } from 'vitest';

import { formatTags, generateDefaultTags, parseTags, validateTags } from './tagsConfigurator.js';

describe('tagsConfigurator', () => {
  describe('parseTags', () => {
    it('should parse comma-separated tags', () => {
      expect(parseTags('tag1,tag2,tag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should trim whitespace', () => {
      expect(parseTags('tag1, tag2 , tag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should filter empty tags', () => {
      expect(parseTags('tag1,,tag2,  ,tag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle single tag', () => {
      expect(parseTags('single')).toEqual(['single']);
    });

    it('should handle empty string', () => {
      expect(parseTags('')).toEqual([]);
    });
  });

  describe('formatTags', () => {
    it('should format tags with comma and space', () => {
      expect(formatTags(['tag1', 'tag2', 'tag3'])).toBe('tag1, tag2, tag3');
    });

    it('should handle single tag', () => {
      expect(formatTags(['single'])).toBe('single');
    });

    it('should handle empty array', () => {
      expect(formatTags([])).toBe('');
    });
  });

  describe('validateTags', () => {
    it('should accept valid tags', () => {
      const result = validateTags(['tag1', 'tag_2', 'tag-3', 'TAG123']);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject empty tags', () => {
      const result = validateTags(['']);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tag cannot be empty');
    });

    it('should reject tags longer than 50 characters', () => {
      const longTag = 'a'.repeat(51);
      const result = validateTags([longTag]);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('too long');
    });

    it('should reject tags with invalid characters', () => {
      const result = validateTags(['tag with spaces', 'tag@special', 'tag.dot']);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]).toContain('invalid characters');
    });

    it('should accept tags exactly 50 characters', () => {
      const maxTag = 'a'.repeat(50);
      const result = validateTags([maxTag]);

      expect(result.valid).toBe(true);
    });

    it('should accumulate multiple errors', () => {
      const result = validateTags(['', 'a'.repeat(51), 'invalid tag']);

      expect(result.valid).toBe(false);
      // Empty tag (1) + long tag (1) + invalid tag with space (2 errors for space chars) = 4
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('should accept alphanumeric with underscores and hyphens', () => {
      const result = validateTags(['test_tag', 'test-tag', 'test123', 'TEST']);

      expect(result.valid).toBe(true);
    });
  });

  describe('generateDefaultTags', () => {
    it('should generate default tag from server name', () => {
      expect(generateDefaultTags('my-server')).toEqual(['my-server']);
    });

    it('should handle different server names', () => {
      expect(generateDefaultTags('filesystem')).toEqual(['filesystem']);
      expect(generateDefaultTags('test_server')).toEqual(['test_server']);
    });
  });
});
