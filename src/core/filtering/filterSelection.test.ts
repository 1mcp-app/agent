import type { TagQuery } from '@src/domains/preset/types/presetTypes.js';

import {
  type FilterSelectionPreset,
  type FilterSelectionPresetLookup,
  type FilterSelectorInputs,
  resolveFilterSelection,
} from './filterSelection.js';

describe('resolveFilterSelection', () => {
  const presetQuery: TagQuery = { $and: [{ tag: 'web' }, { $not: { tag: 'internal' } }] };

  const presetLookup: FilterSelectionPresetLookup = {
    getPreset: vi.fn((name: string): FilterSelectionPreset | undefined => {
      if (name !== 'production') {
        return undefined;
      }
      return {
        name,
        strategy: 'advanced',
        tagQuery: presetQuery,
        expression: 'web and not internal',
      };
    }),
  };

  function select(inputs: FilterSelectorInputs) {
    return resolveFilterSelection(inputs, { presetLookup });
  }

  it('returns none when no selector is supplied', () => {
    const result = select({});

    expect(result).toMatchObject({
      ok: true,
      selection: {
        mode: 'none',
        requestedTags: [],
        compatibility: {
          tags: undefined,
          tagExpression: undefined,
          tagQuery: undefined,
          tagFilterMode: 'none',
          presetName: undefined,
          tagWarnings: [],
        },
      },
    });
  });

  it('rejects multiple selectors instead of silently applying precedence', () => {
    const result = select({ preset: 'production', tags: 'web' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'multiple_selectors',
        message:
          'Cannot use multiple filtering parameters simultaneously. Use "preset" for dynamic presets, "tag-filter" for advanced expressions, "filter" for legacy compatibility, or "tags" for simple OR filtering.',
        selectors: ['preset', 'tags'],
      },
    });
  });

  it('parses legacy filter as advanced before falling back to simple tags', () => {
    const advanced = select({ filter: 'web+api' });
    expect(advanced).toMatchObject({
      ok: true,
      selection: {
        mode: 'advanced',
        requestedTags: ['web', 'api'],
        compatibility: {
          tags: undefined,
          tagFilterMode: 'advanced',
        },
      },
    });

    const simple = select({ filter: 'web@api,mobile' });
    expect(simple).toMatchObject({
      ok: true,
      selection: {
        mode: 'simple-or',
        requestedTags: ['web@api', 'mobile'],
        compatibility: {
          tags: ['web@api', 'mobile'],
          tagFilterMode: 'simple-or',
        },
      },
    });
  });

  it('normalizes simple tags and returns warnings without failing valid decoded tags', () => {
    const result = select({ tags: 'WEB%20API,mobile,WEB%20API' });

    expect(result).toMatchObject({
      ok: true,
      selection: {
        mode: 'simple-or',
        requestedTags: ['web api', 'mobile'],
        compatibility: {
          tags: ['web api', 'mobile'],
          tagFilterMode: 'simple-or',
          tagWarnings: expect.arrayContaining([
            'Tag "WEB%20API": Tag was URL decoded',
            'Duplicate tag after normalization: "WEB%20API"',
          ]),
        },
      },
    });
  });

  it('returns a validation error for invalid simple tags', () => {
    const result = select({ tags: 'web,' + 'x'.repeat(101) });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_selector',
        selector: 'tags',
        message: expect.stringContaining('Invalid tags:'),
        details: {
          errors: [expect.stringContaining('Tag length cannot exceed 100 characters')],
          invalidTags: ['x'.repeat(101)],
        },
      },
    });
  });

  it('extracts requested tags from negative advanced clauses', () => {
    const result = select({ tagFilter: 'web+!internal' });

    expect(result).toMatchObject({
      ok: true,
      selection: {
        mode: 'advanced',
        requestedTags: ['web', 'internal'],
        compatibility: {
          tagFilterMode: 'advanced',
        },
      },
    });
  });

  it('resolves presets through a narrow lookup port and extracts requested tags from tagQuery', () => {
    const result = select({ preset: 'production' });

    expect(presetLookup.getPreset).toHaveBeenCalledWith('production');
    expect(result).toMatchObject({
      ok: true,
      selection: {
        mode: 'preset',
        presetName: 'production',
        requestedTags: ['web', 'internal'],
        compatibility: {
          tagQuery: presetQuery,
          tagFilterMode: 'preset',
          presetName: 'production',
          tags: ['web', 'internal'],
        },
      },
    });
  });

  it('can validate preset selector shape without local preset lookup for client command passthrough', () => {
    const result = resolveFilterSelection({ preset: 'remote-dev' }, { allowUnknownPreset: true });

    expect(result).toMatchObject({
      ok: true,
      selection: {
        mode: 'preset',
        presetName: 'remote-dev',
        requestedTags: [],
        compatibility: {
          tagFilterMode: 'preset',
          presetName: 'remote-dev',
        },
      },
    });
  });

  it('returns not_found when a preset does not exist', () => {
    const result = select({ preset: 'missing' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'preset_not_found',
        selector: 'preset',
        message: "Preset 'missing' not found",
      },
    });
  });

  it('returns invalid_preset when a preset tag query is malformed', () => {
    const result = resolveFilterSelection(
      { preset: 'broken' },
      {
        presetLookup: {
          getPreset: () => ({
            name: 'broken',
            strategy: 'advanced',
            tagQuery: { $or: 'web' } as unknown as TagQuery,
          }),
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_preset',
        selector: 'preset',
        message: "Preset 'broken' has invalid tag query",
        details: {
          errors: ['$or operator must be an array'],
        },
      },
    });
  });
});
