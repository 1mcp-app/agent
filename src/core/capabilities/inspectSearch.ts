import type { Tool } from '@src/sdk/contracts/index.js';

import { z } from 'zod';

import { readPublicCapabilityRoute } from './catalogGeneration.js';
import { paginateInspectTools } from './inspectPagination.js';

export const inspectSearchOptionsSchema = z
  .object({
    search: z
      .string()
      .refine((value) => value.trim().length > 0, 'Search query must not be blank.')
      .optional(),
    glob: z.boolean().optional(),
    'include-descriptions': z.boolean().optional(),
    'show-descriptions': z.boolean().optional(),
  })
  .passthrough()
  .refine(
    (options) =>
      options.search !== undefined ||
      !(options.glob || options['include-descriptions'] || options['show-descriptions']),
    'Search-only flags require --search.',
  );

export interface InspectSearchTool {
  server: string;
  tool: string;
  requiredArgs: number;
  optionalArgs: number;
  description?: string;
}

export interface InspectSearchResult {
  kind: 'search';
  search: string;
  glob: boolean;
  includeDescriptions: boolean;
  showDescriptions: boolean;
  tools: InspectSearchTool[];
  totalTools: number;
  hasMore: boolean;
  nextCursor?: string;
  complete: boolean;
  sources?: Array<{ server: string; status: string; available: boolean }>;
  _meta?: Record<string, unknown>;
}

/** Match only the catalog's public routes, then page the freshly authorized inventory. */
export function searchInspectTools(
  tools: Tool[],
  options: {
    search: string;
    target?: string;
    limit?: number;
    all?: boolean;
    cursor?: string;
    glob?: boolean;
    'include-descriptions'?: boolean;
    'show-descriptions'?: boolean;
  },
  scope: unknown,
  facts: Pick<InspectSearchResult, 'complete' | 'sources' | '_meta'>,
): InspectSearchResult {
  const inventory = tools
    .flatMap((tool): InspectSearchTool[] => {
      const route = readPublicCapabilityRoute(tool);
      if (!route || (options.target && route.server !== options.target)) return [];
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      const required = new Set(tool.inputSchema.required ?? []);
      return [
        {
          server: route.server,
          tool: route.upstreamIdentity,
          requiredArgs: properties.filter((key) => required.has(key)).length,
          optionalArgs: properties.filter((key) => !required.has(key)).length,
          ...(tool.description === undefined ? {} : { description: tool.description }),
        },
      ];
    })
    .sort((a, b) => {
      const left = `${a.server}/${a.tool}`;
      const right = `${b.server}/${b.tool}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const matchesQuery = createSearchMatcher(options.search, options.glob ?? false);
  const matches = inventory.filter(
    (tool) =>
      matchesQuery(`${tool.server}/${tool.tool}`) ||
      (options['include-descriptions'] && tool.description !== undefined && matchesQuery(tool.description)),
  );
  const page = paginateInspectTools(matches, {
    ...options,
    limit: options.limit ?? 20,
    scope: {
      scope,
      target: options.target,
      search: options.search,
      glob: options.glob ?? false,
      includeDescriptions: options['include-descriptions'] ?? false,
      showDescriptions: options['show-descriptions'] ?? false,
      inventory: tools,
      facts,
    },
  });
  return {
    kind: 'search',
    search: options.search,
    glob: options.glob ?? false,
    includeDescriptions: options['include-descriptions'] ?? false,
    showDescriptions: options['show-descriptions'] ?? false,
    ...facts,
    ...page,
    tools: options['show-descriptions'] ? page.tools : page.tools.map(({ description: _description, ...tool }) => tool),
  };
}

/** A wildcard scanner avoids regex backtracking on untrusted search patterns. */
function createSearchMatcher(query: string, glob: boolean): (value: string) => boolean {
  const pattern = Array.from(query.toLowerCase());
  if (!glob) return (value) => value.toLowerCase().includes(query.toLowerCase());
  return (value) => {
    const characters = Array.from(value.toLowerCase());
    let patternIndex = 0;
    let valueIndex = 0;
    let starIndex = -1;
    let restartIndex = 0;
    while (valueIndex < characters.length) {
      if (pattern[patternIndex] === '*') {
        starIndex = patternIndex++;
        restartIndex = valueIndex;
      } else if (pattern[patternIndex] === '?' || pattern[patternIndex] === characters[valueIndex]) {
        patternIndex++;
        valueIndex++;
      } else if (starIndex >= 0) {
        patternIndex = starIndex + 1;
        valueIndex = ++restartIndex;
      } else {
        return false;
      }
    }
    while (pattern[patternIndex] === '*') patternIndex++;
    return patternIndex === pattern.length;
  };
}
