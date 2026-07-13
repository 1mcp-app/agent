import type { InboundConnectionConfig } from '@src/core/types/index.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagExpression, TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import type { PresetStrategy, TagQuery } from '@src/domains/preset/types/presetTypes.js';
import { validateAndSanitizeTags } from '@src/utils/validation/sanitization.js';

export type FilterSelectionMode = 'preset' | 'advanced' | 'simple-or' | 'none';
export type FilterSelectorName = 'preset' | 'tag-filter' | 'filter' | 'tags';

export interface FilterSelectorInputs {
  preset?: unknown;
  tagFilter?: unknown;
  filter?: unknown;
  tags?: unknown;
}

export interface FilterSelectionPreset {
  name: string;
  strategy: PresetStrategy;
  tagQuery: TagQuery;
  expression?: string;
}

export interface FilterSelectionPresetLookup {
  getPreset(name: string): FilterSelectionPreset | undefined;
}

export interface FilterSelectionCompatibilityLocals {
  tags?: string[];
  tagExpression?: TagExpression;
  tagQuery?: TagQuery;
  tagFilterMode: FilterSelectionMode;
  presetName?: string;
  tagWarnings: string[];
}

export interface FilterSelection {
  mode: FilterSelectionMode;
  requestedTags: string[];
  tags?: string[];
  tagExpression?: TagExpression;
  tagQuery?: TagQuery;
  presetName?: string;
  compatibility: FilterSelectionCompatibilityLocals;
  runtimeConfig: InboundConnectionConfig;
}

export type FilterSelectionError =
  | {
      code: 'multiple_selectors';
      message: string;
      selectors: FilterSelectorName[];
    }
  | {
      code: 'invalid_selector';
      selector: FilterSelectorName;
      message: string;
      details?: Record<string, unknown>;
    }
  | {
      code: 'preset_not_found';
      selector: 'preset';
      message: string;
    }
  | {
      code: 'invalid_preset';
      selector: 'preset';
      message: string;
      details?: Record<string, unknown>;
    };

export type FilterSelectionResult =
  { ok: true; selection: FilterSelection } | { ok: false; error: FilterSelectionError };

export interface ResolveFilterSelectionOptions {
  presetLookup?: FilterSelectionPresetLookup;
  allowUnknownPreset?: boolean;
}

const MULTIPLE_SELECTORS_MESSAGE =
  'Cannot use multiple filtering parameters simultaneously. Use "preset" for dynamic presets, "tag-filter" for advanced expressions, "filter" for legacy compatibility, or "tags" for simple OR filtering.';

export function resolveFilterSelection(
  inputs: FilterSelectorInputs,
  options: ResolveFilterSelectionOptions = {},
): FilterSelectionResult {
  const selectors = getPresentSelectors(inputs);

  if (selectors.length > 1) {
    return {
      ok: false,
      error: {
        code: 'multiple_selectors',
        message: MULTIPLE_SELECTORS_MESSAGE,
        selectors,
      },
    };
  }

  const selector = selectors[0];
  if (!selector) {
    return { ok: true, selection: createSelection({ mode: 'none', requestedTags: [] }) };
  }

  switch (selector) {
    case 'preset':
      return resolvePresetSelection(inputs.preset, options.presetLookup, options.allowUnknownPreset);
    case 'tag-filter':
      return resolveAdvancedSelection(inputs.tagFilter, 'tag-filter');
    case 'filter':
      return resolveLegacyFilterSelection(inputs.filter);
    case 'tags':
      return resolveSimpleTagsSelection(inputs.tags, 'tags', 'Invalid tags');
  }
}

export function getRequestedTagsFromExpression(expression: TagExpression): string[] {
  const tags = new Set<string>();

  function visit(expr: TagExpression): void {
    if (expr.type === 'tag') {
      if (expr.value) {
        tags.add(expr.value);
      }
      return;
    }

    for (const child of expr.children ?? []) {
      visit(child);
    }
  }

  visit(expression);
  return Array.from(tags);
}

export function getRequestedTagsFromQuery(query: TagQuery): string[] {
  const tags = new Set<string>();

  function addTag(value: unknown): void {
    if (typeof value === 'string' && value.trim()) {
      tags.add(value.trim().toLowerCase());
    }
  }

  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') {
      return;
    }

    const node = value as TagQuery;
    addTag(node.tag);

    for (const child of node.$or ?? []) {
      visit(child);
    }
    for (const child of node.$and ?? []) {
      visit(child);
    }
    visit(node.$not);
    for (const tag of node.$in ?? []) {
      addTag(tag);
    }

    for (const [key, nested] of Object.entries(node)) {
      if (key === 'tag' || key === '$or' || key === '$and' || key === '$not' || key === '$in') {
        continue;
      }

      if (key === '$advanced' && typeof nested === 'string') {
        try {
          getRequestedTagsFromExpression(TagQueryParser.parseAdvanced(nested)).forEach((tag) => tags.add(tag));
        } catch {
          // Validation of advanced preset strings happens elsewhere; keep extraction best-effort.
        }
        continue;
      }

      if (!nested || typeof nested !== 'object') {
        continue;
      }

      const fieldQuery = nested as Record<string, unknown>;
      if (Array.isArray(fieldQuery.$in)) {
        fieldQuery.$in.forEach(addTag);
      }
      addTag(fieldQuery.$not);
      visit(fieldQuery.$not);
    }
  }

  visit(query);
  return Array.from(tags);
}

function getPresentSelectors(inputs: FilterSelectorInputs): FilterSelectorName[] {
  const selectors: FilterSelectorName[] = [];

  if (inputs.preset !== undefined) selectors.push('preset');
  if (inputs.tagFilter !== undefined) selectors.push('tag-filter');
  if (inputs.filter !== undefined) selectors.push('filter');
  if (inputs.tags !== undefined) selectors.push('tags');

  return selectors;
}

function resolvePresetSelection(
  rawPreset: unknown,
  presetLookup: FilterSelectionPresetLookup | undefined,
  allowUnknownPreset = false,
): FilterSelectionResult {
  if (typeof rawPreset !== 'string') {
    return invalidSelector('preset', 'Invalid params: preset must be a string');
  }

  const presetName = rawPreset.trim();
  if (!presetName) {
    return invalidSelector('preset', 'Invalid params: preset cannot be empty');
  }

  const preset = presetLookup?.getPreset(presetName);
  if (!preset) {
    if (allowUnknownPreset) {
      return {
        ok: true,
        selection: createSelection({
          mode: 'preset',
          requestedTags: [],
          presetName,
        }),
      };
    }

    return {
      ok: false,
      error: {
        code: 'preset_not_found',
        selector: 'preset',
        message: `Preset '${presetName}' not found`,
      },
    };
  }

  const validation = TagQueryEvaluator.validateQuery(preset.tagQuery);
  if (!validation.isValid) {
    return {
      ok: false,
      error: {
        code: 'invalid_preset',
        selector: 'preset',
        message: `Preset '${presetName}' has invalid tag query`,
        details: { errors: validation.errors },
      },
    };
  }

  const requestedTags = getRequestedTagsFromQuery(preset.tagQuery);
  return {
    ok: true,
    selection: createSelection({
      mode: 'preset',
      requestedTags,
      tags: requestedTags,
      tagQuery: preset.tagQuery,
      presetName,
    }),
  };
}

function resolveAdvancedSelection(rawExpression: unknown, selector: FilterSelectorName): FilterSelectionResult {
  if (typeof rawExpression !== 'string') {
    return invalidSelector(selector, `Invalid params: ${selector} must be a string`);
  }

  try {
    const tagExpression = TagQueryParser.parseAdvanced(rawExpression);
    return {
      ok: true,
      selection: createSelection({
        mode: 'advanced',
        requestedTags: getRequestedTagsFromExpression(tagExpression),
        tags: tagExpression.type === 'tag' && tagExpression.value ? [tagExpression.value] : undefined,
        tagExpression,
      }),
    };
  } catch (error) {
    return invalidSelector(
      selector,
      `Invalid ${selector}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

function resolveLegacyFilterSelection(rawFilter: unknown): FilterSelectionResult {
  if (typeof rawFilter !== 'string') {
    return invalidSelector('filter', 'Invalid params: filter must be a string');
  }

  const advancedResult = resolveAdvancedSelection(rawFilter, 'filter');
  if (advancedResult.ok) {
    return advancedResult;
  }

  const simpleResult = resolveSimpleTagsSelection(rawFilter, 'filter', 'Invalid filter');
  if (simpleResult.ok) {
    return simpleResult;
  }

  return simpleResult.error.code === 'invalid_selector'
    ? simpleResult
    : invalidSelector('filter', 'Invalid filter: empty or malformed filter expression');
}

function resolveSimpleTagsSelection(
  rawTags: unknown,
  selector: FilterSelectorName,
  messagePrefix: string,
): FilterSelectionResult {
  if (typeof rawTags !== 'string') {
    return invalidSelector(selector, `Invalid params: ${selector} must be a string`);
  }

  const parsedTags = TagQueryParser.parseSimple(rawTags);
  if (parsedTags.length === 0) {
    return invalidSelector(selector, `${messagePrefix}: empty or malformed filter expression`);
  }

  const validation = validateAndSanitizeTags(parsedTags);
  if (validation.errors.length > 0) {
    return invalidSelector(selector, `${messagePrefix}: ${validation.errors.join('; ')}`, {
      errors: validation.errors,
      warnings: validation.warnings,
      invalidTags: validation.invalidTags,
    });
  }

  return {
    ok: true,
    selection: createSelection({
      mode: 'simple-or',
      requestedTags: validation.validTags,
      tags: validation.validTags.length > 0 ? validation.validTags : undefined,
      tagWarnings: validation.warnings,
    }),
  };
}

function createSelection(input: {
  mode: FilterSelectionMode;
  requestedTags: string[];
  tags?: string[];
  tagExpression?: TagExpression;
  tagQuery?: TagQuery;
  presetName?: string;
  tagWarnings?: string[];
}): FilterSelection {
  const compatibility: FilterSelectionCompatibilityLocals = {
    tags: input.tags,
    tagExpression: input.tagExpression,
    tagQuery: input.tagQuery,
    tagFilterMode: input.mode,
    presetName: input.presetName,
    tagWarnings: input.tagWarnings ?? [],
  };

  return {
    mode: input.mode,
    requestedTags: input.requestedTags,
    tags: input.tags,
    tagExpression: input.tagExpression,
    tagQuery: input.tagQuery,
    presetName: input.presetName,
    compatibility,
    runtimeConfig: {
      tags: input.tags,
      tagExpression: input.tagExpression,
      tagQuery: input.tagQuery,
      tagFilterMode: input.mode,
      presetName: input.presetName,
    },
  };
}

function invalidSelector(
  selector: FilterSelectorName,
  message: string,
  details?: Record<string, unknown>,
): FilterSelectionResult {
  return {
    ok: false,
    error: {
      code: 'invalid_selector',
      selector,
      message,
      ...(details ? { details } : {}),
    },
  };
}
