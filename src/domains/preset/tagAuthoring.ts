import type { TagQuery } from './types/presetTypes.js';

export type TagAuthoringState = 'neutral' | 'include' | 'exclude';

export interface ParsedTagAuthoringQuery {
  strategy: 'or' | 'and';
  states: Record<string, TagAuthoringState>;
}

export function buildTagAuthoringQuery(states: Record<string, TagAuthoringState>, strategy: 'or' | 'and'): TagQuery {
  const included = selectedTags(states, 'include');
  const excluded = selectedTags(states, 'exclude');
  const clauses: TagQuery[] = [];

  if (included.length === 1) clauses.push({ tag: included[0] });
  if (included.length > 1) clauses.push({ [strategy === 'or' ? '$or' : '$and']: included.map((tag) => ({ tag })) });
  clauses.push(...excluded.map((tag) => ({ $not: { tag } })));

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

export function evaluateTagAuthoringQuery(query: TagQuery, tags: string[]): boolean {
  if (query.tag) return tags.includes(query.tag);
  if (query.$or) return query.$or.some((clause) => evaluateTagAuthoringQuery(clause, tags));
  if (query.$and) return query.$and.every((clause) => evaluateTagAuthoringQuery(clause, tags));
  if (query.$not) return !evaluateTagAuthoringQuery(query.$not, tags);
  if (query.$in) return query.$in.some((tag) => tags.includes(tag));
  return false;
}

export function parseTagAuthoringQuery(query: TagQuery): ParsedTagAuthoringQuery | null {
  const states: Record<string, TagAuthoringState> = {};
  const parsed = parseRoot(query, states);
  return parsed ? { strategy: parsed, states } : null;
}

function parseRoot(query: TagQuery, states: Record<string, TagAuthoringState>): 'or' | 'and' | null {
  if (typeof query.tag === 'string' && Object.keys(query).length === 1) {
    states[query.tag] = 'include';
    return 'or';
  }
  if (query.$not && Object.keys(query).length === 1 && readSingleTag(query.$not)) {
    states[readSingleTag(query.$not)!] = 'exclude';
    return 'or';
  }
  if (query.$or && Object.keys(query).length === 1 && readIncludedTags(query.$or, states)) return 'or';
  if (query.$and && Object.keys(query).length === 1) {
    const clauses = query.$and;
    const inclusionClauses = clauses.filter((clause) => clause.tag || clause.$or || clause.$and);
    const exclusionClauses = clauses.filter((clause) => clause.$not);
    if (clauses.length !== inclusionClauses.length + exclusionClauses.length) return null;
    let strategy: 'or' | 'and' = 'and';
    if (inclusionClauses.length > 1) {
      if (!readIncludedTags(inclusionClauses, states)) return null;
    } else {
      const includeClause = inclusionClauses[0];
      if (includeClause?.tag) states[includeClause.tag] = 'include';
      else if (includeClause?.$or && readIncludedTags(includeClause.$or, states)) strategy = 'or';
      else if (includeClause?.$and && readIncludedTags(includeClause.$and, states)) strategy = 'and';
      else if (includeClause) return null;
    }
    for (const clause of exclusionClauses) {
      const tag = clause.$not ? readSingleTag(clause.$not) : null;
      if (!tag) return null;
      states[tag] = 'exclude';
    }
    return strategy;
  }
  return Object.keys(query).length === 0 ? 'or' : null;
}

function readIncludedTags(clauses: TagQuery[], states: Record<string, TagAuthoringState>): boolean {
  for (const clause of clauses) {
    const tag = readSingleTag(clause);
    if (!tag) return false;
    states[tag] = 'include';
  }
  return true;
}

function readSingleTag(query: TagQuery): string | null {
  return typeof query.tag === 'string' && Object.keys(query).length === 1 ? query.tag : null;
}

function selectedTags(states: Record<string, TagAuthoringState>, state: TagAuthoringState): string[] {
  return Object.entries(states)
    .filter(([, value]) => value === state)
    .map(([tag]) => tag);
}
