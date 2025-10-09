// Shared session types for server and client session managers
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

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
