export type OfficialClientRevision = '2025-11-25' | '2026-07-28';
export type OfficialClientScenarioFamily =
  | 'auth'
  | 'initialize'
  | 'tools'
  | 'request-metadata'
  | 'elicitation'
  | 'sse-retry'
  | 'request-state'
  | 'standard-headers'
  | 'custom-headers'
  | 'invalid-headers'
  | 'schema';

export const OFFICIAL_CLIENT_SCENARIOS: Record<OfficialClientRevision, readonly string[]>;

export function officialClientScenarioFamily(
  revision: OfficialClientRevision,
  scenario: string,
): OfficialClientScenarioFamily | null;
