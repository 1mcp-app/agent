// Re-export MCPServerParams from core types for template processor
export type { MCPServerParams } from '@src/core/types/index.js';

/**
 * Git repository information
 */
export interface GitInfo {
  branch?: string;
  commit?: string;
  repository?: string;
  isRepo?: boolean;
}

/**
 * Context namespace information
 */
export interface ContextNamespace {
  path?: string;
  name?: string;
  git?: GitInfo;
  environment?: string;
  custom?: Record<string, unknown>;
}

/**
 * User context information
 */
export interface UserContext {
  name?: string;
  email?: string;
  home?: string;
  username?: string;
  uid?: string;
  gid?: string;
  shell?: string;
}

/**
 * Environment context information
 */
export interface EnvironmentContext {
  variables?: Record<string, string>;
  prefixes?: string[];
}

/**
 * Client information from MCP initialize request
 */
export interface ClientInfo {
  /** Name of the AI client application (e.g., "claude-code", "cursor", "vscode") */
  name: string;
  /** Version of the AI client application */
  version: string;
  /** Optional human-readable display name */
  title?: string;
}

/**
 * Complete context data
 */
export interface ContextData {
  project: ContextNamespace;
  user: UserContext;
  environment: EnvironmentContext;
  timestamp?: string;
  sessionId?: string;
  version?: string;
  transport?: {
    type: string;
    url?: string;
    connectionId?: string;
    connectionTimestamp?: string;
    /** Client information extracted from MCP initialize request */
    client?: ClientInfo;
  };
}

/**
 * Context collection options
 */
export interface ContextCollectionOptions {
  includeGit?: boolean;
  includeEnv?: boolean;
  envPrefixes?: string[];
  sanitizePaths?: boolean;
  maxDepth?: number;
}

/**
 * Template variable interface
 */
export interface TemplateVariable {
  name: string;
  namespace: 'project' | 'user' | 'environment' | 'context' | 'transport';
  path: string[];
  optional: boolean;
  defaultValue?: string;
  functions?: Array<{ name: string; args: string[] }>;
}

/**
 * Template context for variable substitution
 */
export interface TemplateContext {
  project: ContextNamespace;
  user: UserContext;
  environment: EnvironmentContext;
  context: {
    path: string;
    timestamp: string;
    sessionId: string;
    version: string;
  };
  transport?: {
    type: string;
    url?: string;
    connectionId?: string;
    connectionTimestamp?: string;
    client?: {
      name: string;
      version: string;
      title?: string;
    };
  };
}

export function formatTimestamp(): string {
  return new Date().toISOString();
}
