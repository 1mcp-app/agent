import { TagState } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';

export function isValidTagQuery(obj: unknown): obj is TagQuery {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const query = obj as Record<string, unknown>;

  if (query.tag !== undefined && typeof query.tag !== 'string') return false;
  if (query.$or !== undefined && !Array.isArray(query.$or)) return false;
  if (query.$and !== undefined && !Array.isArray(query.$and)) return false;
  if (query.$not !== undefined && !isValidTagQuery(query.$not)) return false;
  if (query.$in !== undefined && !Array.isArray(query.$in)) return false;

  if (query.$or && Array.isArray(query.$or) && !query.$or.every((item) => isValidTagQuery(item))) {
    return false;
  }

  if (query.$and && Array.isArray(query.$and) && !query.$and.every((item) => isValidTagQuery(item))) {
    return false;
  }

  if (query.$in && Array.isArray(query.$in) && !query.$in.every((item: unknown) => typeof item === 'string')) {
    return false;
  }

  return true;
}

export function getInitialTagStateFromQuery(tag: string, existingQuery?: TagQuery): TagState {
  if (!existingQuery || !isValidTagQuery(existingQuery)) {
    return 'empty';
  }

  if (queryMatchesNot(existingQuery)) {
    return 'not-selected';
  }

  return queryMatchesTag(existingQuery, tag) ? 'selected' : 'empty';
}

function queryMatchesTag(query: unknown, tag: string): boolean {
  if (!isValidTagQuery(query)) {
    return false;
  }

  if (query.tag === tag) return true;
  if (query.$or && Array.isArray(query.$or)) return query.$or.some((subQuery) => queryMatchesTag(subQuery, tag));
  if (query.$and && Array.isArray(query.$and)) return query.$and.some((subQuery) => queryMatchesTag(subQuery, tag));
  if (query.$in && Array.isArray(query.$in)) {
    return query.$in.some((item): item is string => typeof item === 'string' && item === tag);
  }
  if (query.$not) return queryMatchesTag(query.$not, tag);
  return false;
}

function queryMatchesNot(query: unknown): boolean {
  if (!isValidTagQuery(query)) {
    return false;
  }

  if (query.$not) return true;
  if (query.$and && Array.isArray(query.$and)) {
    return query.$and.some((subQuery) => isValidTagQuery(subQuery) && Boolean(subQuery.$not));
  }
  if (query.$or && Array.isArray(query.$or)) {
    return query.$or.some((subQuery) => isValidTagQuery(subQuery) && Boolean(subQuery.$not));
  }
  return false;
}
