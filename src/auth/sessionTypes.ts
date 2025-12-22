// Shared session types for server and client session managers
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

import { ContextNamespace, EnvironmentContext, UserContext } from '@src/types/context.js';

/**
 * Base interface for all data that can expire
 */
export interface ExpirableData {
  expires: number;
  createdAt: number;
}

export interface SessionData extends ExpirableData {
  clientId: string;
  resource: string;
  scopes: string[];
}

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
}
