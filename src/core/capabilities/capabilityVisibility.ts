/**
 * Request-scoped capability visibility after session, tag, and preset filtering.
 * Connection keys retain template identity; server names remain the public API.
 */
export interface CapabilityVisibility {
  readonly sessionId?: string;
  readonly serverCandidates: ReadonlyMap<string, string>;
  readonly filterSelection?: Readonly<Record<string, unknown>>;
}

export function createCapabilityVisibility(
  serverCandidates: Iterable<readonly [string, string]>,
  sessionId?: string,
  filterSelection?: Readonly<Record<string, unknown>>,
): CapabilityVisibility {
  return {
    sessionId,
    serverCandidates: new Map(serverCandidates),
    filterSelection,
  };
}

export function capabilityVisibilityFromServerNames(serverNames: Iterable<string>): CapabilityVisibility {
  return createCapabilityVisibility(Array.from(serverNames, (serverName) => [serverName, serverName] as const));
}

export function getCapabilityVisibleServerNames(visibility: CapabilityVisibility): Set<string> {
  return new Set(visibility.serverCandidates.values());
}
