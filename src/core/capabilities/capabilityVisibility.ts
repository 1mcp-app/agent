/**
 * Request-scoped capability visibility after session, tag, and preset filtering.
 * Connection keys retain template identity; server names remain the public API.
 */
declare const resourceRouteOwnerBrand: unique symbol;
export interface ResourceRouteOwner {
  readonly [resourceRouteOwnerBrand]: true;
}
const activeResourceOwners = new WeakSet<ResourceRouteOwner>();
const contextResourceOwners = new WeakMap<object, ResourceRouteOwner>();

/** Resource authority is minted internally and cannot be reconstructed from JSON. */
export function createResourceRouteOwner(): ResourceRouteOwner {
  const owner = Object.freeze({}) as ResourceRouteOwner;
  activeResourceOwners.add(owner);
  return owner;
}

export function isResourceRouteOwnerActive(owner: ResourceRouteOwner): boolean {
  return activeResourceOwners.has(owner);
}

export function revokeResourceRouteOwner(owner: ResourceRouteOwner): void {
  activeResourceOwners.delete(owner);
}

export function bindResourceRouteOwner(context: object, owner: ResourceRouteOwner): void {
  if (!isResourceRouteOwnerActive(owner)) throw new Error('Resource route owner is unavailable');
  contextResourceOwners.set(context, owner);
}

export function getResourceRouteOwner(context: object | undefined): ResourceRouteOwner | undefined {
  return context ? contextResourceOwners.get(context) : undefined;
}

export interface CapabilityVisibility {
  readonly sessionId?: string;
  readonly resourceOwner?: ResourceRouteOwner;
  readonly serverCandidates: ReadonlyMap<string, string>;
  readonly filterSelection?: Readonly<Record<string, unknown>>;
}

export function createCapabilityVisibility(
  serverCandidates: Iterable<readonly [string, string]>,
  sessionId?: string,
  filterSelection?: Readonly<Record<string, unknown>>,
  resourceOwner?: ResourceRouteOwner,
): CapabilityVisibility {
  return {
    sessionId,
    serverCandidates: new Map(serverCandidates),
    filterSelection,
    ...(resourceOwner === undefined ? {} : { resourceOwner }),
  };
}

export function capabilityVisibilityFromServerNames(serverNames: Iterable<string>): CapabilityVisibility {
  return createCapabilityVisibility(Array.from(serverNames, (serverName) => [serverName, serverName] as const));
}

export function getCapabilityVisibleServerNames(visibility: CapabilityVisibility): Set<string> {
  return new Set(visibility.serverCandidates.values());
}
