// Shared session types for server and client session managers
import { OAuthClientInformationFull } from '@src/sdk/legacy/shared/auth.js';

import type { TemplateContextProof } from '@src/core/context/templateContextTrust.js';
import { ContextNamespace, EnvironmentContext, UserContext } from '@src/types/context.js';

import { z } from 'zod';

/**
 * Base interface for all data that can expire
 */
export interface ExpirableData {
  expires: number;
  createdAt: number;
}

const ExpirableDataShape = {
  expires: z.number().finite(),
  createdAt: z.number().finite(),
};

export const SessionDataSchema = z.object({
  ...ExpirableDataShape,
  clientId: z.string().min(1),
  resource: z.string(),
  scopes: z.array(z.string()),
  refreshFamilyId: z.string().optional(),
});
export type SessionData = z.infer<typeof SessionDataSchema>;

const RefreshTokenDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const RefreshTokenFamilyDataSchema = z.object({
  ...ExpirableDataShape,
  familyId: z.string().min(1),
  runtimeScopeId: z.string().min(1),
  clientId: z.string().min(1),
  scopeCeiling: z.array(z.string()),
  resource: z.string(),
  currentTokenDigest: RefreshTokenDigestSchema,
  consumedTokenDigests: z.array(RefreshTokenDigestSchema),
  accessTokenIds: z.array(z.uuid()),
  status: z.enum(['active', 'revoked']),
  revokedAt: z.number().finite().optional(),
});
export type RefreshTokenFamilyData = z.infer<typeof RefreshTokenFamilyDataSchema>;

export const RefreshTokenLookupDataSchema = z.object({
  ...ExpirableDataShape,
  familyId: z.string().min(1),
  runtimeScopeId: z.string().min(1),
  tokenDigest: RefreshTokenDigestSchema,
  state: z.enum(['current', 'consumed']),
});
export type RefreshTokenLookupData = z.infer<typeof RefreshTokenLookupDataSchema>;

export interface ClientData extends ExpirableData, OAuthClientInformationFull {}

export interface AuthCodeData extends ExpirableData {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  codeChallenge?: string;
}

// Unified client session data structure
export interface ClientSessionData extends ExpirableData {
  serverName: string;
  clientInfo?: string; // JSON string of OAuthClientInformationFull
  tokens?: string; // JSON string of OAuthTokens
  codeVerifier?: string;
  state?: string;
}

// Temporary authorization request data for consent flow
export interface AuthRequestData extends ExpirableData {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  state?: string;
  resource?: string;
  scopes?: string[];
}

/**
 * Initialize response data captured for proper session restoration.
 *
 * This data is stored during normal session initialization and replayed
 * during session restoration to properly initialize the SDK's internal state
 * through its public API (handleRequest), avoiding fragile private property access.
 */
export interface InitializeResponseData {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: {
    name: string;
    version: string;
  };
}

// Streamable HTTP session data for session restoration
export interface StreamableSessionData extends ExpirableData {
  tags?: string[];
  tagExpression?: string; // JSON stringified TagExpression
  tagQuery?: string; // JSON stringified TagQuery
  tagFilterMode?: 'simple-or' | 'advanced' | 'preset' | 'none';
  presetName?: string;
  enablePagination?: boolean;
  customTemplate?: string;
  lastAccessedAt: number;
  initializeResponse?: InitializeResponseData;
  context?: {
    project?: ContextNamespace;
    user?: UserContext;
    environment?: EnvironmentContext;
    timestamp?: string;
    version?: string;
    sessionId?: string;
    transport?: {
      type: string;
      connectionId?: string;
      connectionTimestamp?: string;
      client?: {
        name: string;
        version: string;
        title?: string;
      };
    };
  };
  contextProof?: TemplateContextProof;
}
