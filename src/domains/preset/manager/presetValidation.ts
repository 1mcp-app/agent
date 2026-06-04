import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { PresetConfig, PresetValidationResult } from '@src/domains/preset/types/presetTypes.js';

export function validatePresetConfig(
  name: string,
  config: Omit<PresetConfig, 'name' | 'created' | 'lastModified'>,
): PresetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!name || typeof name !== 'string') {
    errors.push('Preset name is required and must be a string');
  } else if (name.length > 50) {
    errors.push('Preset name must be 50 characters or less');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    errors.push('Preset name can only contain letters, numbers, hyphens, and underscores');
  }

  if (!config.strategy || !['or', 'and', 'advanced'].includes(config.strategy)) {
    errors.push('Strategy must be one of: or, and, advanced');
  }

  if (!config.tagQuery || typeof config.tagQuery !== 'object') {
    errors.push('Tag query is required and must be an object');
  } else {
    try {
      const validation = TagQueryEvaluator.validateQuery(config.tagQuery);
      if (!validation.isValid) {
        errors.push(...validation.errors.map((err) => `Tag query: ${err}`));
      }

      const queryString = TagQueryEvaluator.queryToString(config.tagQuery);
      if (!queryString.trim()) {
        warnings.push('Tag query produces no meaningful filter');
      }
    } catch (error) {
      errors.push(`Invalid tag query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
