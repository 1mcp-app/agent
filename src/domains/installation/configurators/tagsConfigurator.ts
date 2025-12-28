/**
 * Tags configuration helpers
 */
import { TagsValidationResult } from '@src/types/validation.js';

/**
 * Parse tags from comma-separated string
 */
export function parseTags(tagsString: string): string[] {
  return tagsString
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Format tags array to comma-separated string
 */
export function formatTags(tags: string[]): string {
  return tags.join(', ');
}

/**
 * Validate tags format
 */
export function validateTags(tags: string[]): TagsValidationResult {
  const errors: string[] = [];

  for (const tag of tags) {
    if (tag.length === 0) {
      errors.push('Tag cannot be empty');
    }
    if (tag.length > 50) {
      errors.push(`Tag '${tag}' is too long (max 50 characters)`);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(tag)) {
      errors.push(`Tag '${tag}' contains invalid characters (only alphanumeric, underscore, and hyphen allowed)`);
    }
  }

  if (errors.length === 0) {
    return { valid: true };
  }
  return { valid: false, errors };
}

/**
 * Generate default tags from server name
 */
export function generateDefaultTags(serverName: string): string[] {
  return [serverName];
}
