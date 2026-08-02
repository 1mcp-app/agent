export interface FilterSelectionOptions {
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
}

export function buildFilterSelectionQuery(options: FilterSelectionOptions): Record<string, string> {
  if (options.preset) return { preset: options.preset };
  if (options['tag-filter']) return { 'tag-filter': options['tag-filter'] };
  if (options.filter) return { filter: options.filter };
  if (options.tags?.length) return { tags: options.tags.join(',') };
  return {};
}
