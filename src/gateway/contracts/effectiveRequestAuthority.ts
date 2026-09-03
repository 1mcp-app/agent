export interface EffectiveRequestAuthority {
  readonly connectionIds: readonly string[];
  readonly provenance: readonly string[];
}

function canonicalStrings(values: readonly string[], name: string): readonly string[] {
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError(`${name} must contain non-empty strings`);
  }
  return Object.freeze([...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
}

export function createEffectiveRequestAuthority(input: {
  connectionIds: readonly string[];
  provenance?: readonly string[];
}): EffectiveRequestAuthority {
  return Object.freeze({
    connectionIds: canonicalStrings(input.connectionIds, 'connectionIds'),
    provenance: canonicalStrings(input.provenance ?? [], 'provenance'),
  });
}

/** Returns an authority no broader than the parent, regardless of requested identifiers. */
export function narrowEffectiveRequestAuthority(
  parent: EffectiveRequestAuthority,
  requestedConnectionIds: readonly string[],
  provenance: readonly string[] = [],
): EffectiveRequestAuthority {
  const allowed = new Set(parent.connectionIds);
  return createEffectiveRequestAuthority({
    connectionIds: requestedConnectionIds.filter((connectionId) => allowed.has(connectionId)),
    provenance: [...parent.provenance, ...provenance],
  });
}

export function authorityAllows(authority: EffectiveRequestAuthority, connectionId: string): boolean {
  return authority.connectionIds.includes(connectionId);
}
