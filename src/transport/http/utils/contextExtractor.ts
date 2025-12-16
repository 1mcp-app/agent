import logger from '@src/logger/logger.js';
import type { ContextNamespace, EnvironmentContext, UserContext } from '@src/types/context.js';

import type { Request } from 'express';

// Header constants for context transmission
export const CONTEXT_HEADERS = {
  SESSION_ID: 'mcp-session-id', // Use standard streamable HTTP header
  VERSION: 'x-1mcp-context-version',
  DATA: 'x-1mcp-context', // Base64 encoded context JSON
} as const;

/**
 * Type guard to check if a value is a valid ContextData
 */
function isContextData(value: unknown): value is {
  project: ContextNamespace;
  user: UserContext;
  environment: EnvironmentContext;
  timestamp?: string;
  version?: string;
  sessionId?: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'project' in value &&
    'user' in value &&
    'environment' in value &&
    typeof (value as { project: unknown }).project === 'object' &&
    typeof (value as { user: unknown }).user === 'object' &&
    typeof (value as { environment: unknown }).environment === 'object'
  );
}

/**
 * Extract context data from HTTP headers
 */
export function extractContextFromHeaders(req: Request): {
  project?: ContextNamespace;
  user?: UserContext;
  environment?: EnvironmentContext;
  timestamp?: string;
  version?: string;
  sessionId?: string;
} | null {
  try {
    // Check if context headers are present
    const contextDataHeader = req.headers[CONTEXT_HEADERS.DATA.toLowerCase()];
    const sessionIdHeader = req.headers[CONTEXT_HEADERS.SESSION_ID.toLowerCase()];
    const versionHeader = req.headers[CONTEXT_HEADERS.VERSION.toLowerCase()];

    if (
      typeof contextDataHeader !== 'string' ||
      typeof sessionIdHeader !== 'string' ||
      typeof versionHeader !== 'string'
    ) {
      return null;
    }

    // Decode base64 context data
    const contextJson = Buffer.from(contextDataHeader, 'base64').toString('utf-8');
    let parsedContext: unknown;
    try {
      parsedContext = JSON.parse(contextJson);
    } catch (parseError) {
      logger.warn(
        'Failed to parse context JSON:',
        parseError instanceof Error ? parseError : new Error(String(parseError)),
      );
      return null;
    }

    // Validate that the parsed context has the correct structure
    if (!isContextData(parsedContext)) {
      logger.warn('Invalid context structure in JSON, ignoring context');
      return null;
    }

    const context = parsedContext;

    // Validate basic structure
    if (context && context.project && context.user && context.sessionId === sessionIdHeader) {
      logger.debug(`Context validation passed: sessionId=${context.sessionId}, header=${sessionIdHeader}`);
      logger.info(`📊 Extracted context from headers: ${context.project.name} (${context.sessionId})`);

      return {
        project: context.project,
        user: context.user,
        environment: context.environment,
        timestamp: context.timestamp,
        version: context.version,
        sessionId: context.sessionId,
      };
    } else {
      logger.warn('Invalid context structure in headers, ignoring context', {
        hasContext: !!context,
        hasProject: !!context?.project,
        hasUser: !!context?.user,
        sessionIdsMatch: context?.sessionId === sessionIdHeader,

        contextSessionId: context?.sessionId || undefined,
        headerSessionId: sessionIdHeader,
      });
      return null;
    }
  } catch (error) {
    logger.error('Failed to extract context from headers:', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Extract context data from query parameters (sent by proxy)
 */
export function extractContextFromQuery(req: Request): {
  project?: ContextNamespace;
  user?: UserContext;
  environment?: EnvironmentContext;
  timestamp?: string;
  version?: string;
  sessionId?: string;
} | null {
  try {
    const query = req.query;

    // Check if essential context query parameters are present
    const projectPath = query.project_path;
    const projectName = query.project_name;
    const projectEnv = query.project_env;
    const userUsername = query.user_username;
    const contextSessionId = query.context_session_id;
    const contextTimestamp = query.context_timestamp;
    const contextVersion = query.context_version;
    const envNodeVersion = query.env_node_version;
    const envPlatform = query.env_platform;

    // Require at minimum: project_path and project_name for valid context
    if (!projectPath || !projectName || !contextSessionId) {
      return null;
    }

    const context = {
      project: {
        path: String(projectPath),
        name: String(projectName),
        environment: projectEnv ? String(projectEnv) : 'development',
      },
      user: {
        username: userUsername ? String(userUsername) : 'unknown',
        home: '', // Not available from query params
      },
      environment: {
        variables: {
          NODE_VERSION: envNodeVersion ? String(envNodeVersion) : process.version,
          PLATFORM: envPlatform ? String(envPlatform) : process.platform,
        },
      },
      timestamp: contextTimestamp ? String(contextTimestamp) : new Date().toISOString(),
      version: contextVersion ? String(contextVersion) : 'unknown',
      sessionId: String(contextSessionId),
    };

    logger.info(`📊 Extracted context from query params: ${context.project.name} (${context.sessionId})`);
    logger.debug('Query context details', {
      projectPath: context.project.path,
      projectEnv: context.project.environment,
      userUsername: context.user.username,
      hasTimestamp: !!context.timestamp,
      hasVersion: !!context.version,
    });

    return context;
  } catch (error) {
    logger.error(
      'Failed to extract context from query params:',
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

/**
 * Extract context data from individual X-Context-* headers
 * This handles the case where context is sent as separate headers
 */
function extractContextFromIndividualHeaders(req: Request): {
  project?: ContextNamespace;
  user?: UserContext;
  environment?: EnvironmentContext;
  timestamp?: string;
  version?: string;
  sessionId?: string;
} | null {
  try {
    const headers = req.headers;

    // Extract individual context headers
    const projectName = headers['x-context-project-name'];
    const projectPath = headers['x-context-project-path'];
    const userName = headers['x-context-user-name'];
    const userEmail = headers['x-context-user-email'];
    const environmentName = headers['x-context-environment-name'];
    const environmentPlatform = headers['x-context-environment-platform'];
    const sessionId = headers['x-context-session-id'];
    const timestamp = headers['x-context-timestamp'];
    const version = headers['x-context-version'];

    // Require at minimum: project path and session ID for valid context
    if (!projectPath || !sessionId) {
      return null;
    }

    const context: {
      project?: ContextNamespace;
      user?: UserContext;
      environment?: EnvironmentContext;
      timestamp?: string;
      version?: string;
      sessionId?: string;
    } = {
      sessionId: Array.isArray(sessionId) ? sessionId[0] : sessionId,
    };

    // Build project context
    if (projectPath) {
      context.project = {
        path: Array.isArray(projectPath) ? projectPath[0] : projectPath,
      };
      if (projectName) {
        context.project.name = Array.isArray(projectName) ? projectName[0] : projectName;
      }
    }

    // Build user context
    if (userName || userEmail) {
      context.user = {};
      if (userName) {
        context.user.name = Array.isArray(userName) ? userName[0] : userName;
      }
      if (userEmail) {
        context.user.email = Array.isArray(userEmail) ? userEmail[0] : userEmail;
      }
    }

    // Build environment context
    if (environmentName || environmentPlatform) {
      context.environment = {
        variables: {},
      };
      if (environmentName) {
        context.environment.variables!.name = Array.isArray(environmentName) ? environmentName[0] : environmentName;
      }
      if (environmentPlatform) {
        context.environment.variables!.platform = Array.isArray(environmentPlatform)
          ? environmentPlatform[0]
          : environmentPlatform;
      }
    }

    // Add optional fields
    if (timestamp) {
      context.timestamp = Array.isArray(timestamp) ? timestamp[0] : timestamp;
    }
    if (version) {
      context.version = Array.isArray(version) ? version[0] : version;
    }

    return context;
  } catch (error) {
    logger.warn('Failed to extract context from individual headers:', error);
    return null;
  }
}

/**
 * Extract context data from both headers and query parameters
 * Query parameters take priority (for proxy use case)
 */
export function extractContextFromHeadersOrQuery(req: Request): {
  project?: ContextNamespace;
  user?: UserContext;
  environment?: EnvironmentContext;
  timestamp?: string;
  version?: string;
  sessionId?: string;
} | null {
  // Try query parameters first (proxy use case)
  const queryContext = extractContextFromQuery(req);
  if (queryContext) {
    logger.debug('Using context from query parameters');
    return queryContext;
  }

  // Fall back to individual headers (new functionality)
  const individualHeadersContext = extractContextFromIndividualHeaders(req);
  if (individualHeadersContext) {
    logger.debug('Using context from individual X-Context-* headers');
    return individualHeadersContext;
  }

  // Fall back to combined headers (direct HTTP use case)
  const headerContext = extractContextFromHeaders(req);
  if (headerContext) {
    logger.debug('Using context from combined headers');
    return headerContext;
  }

  logger.debug('No context found in headers or query parameters');
  return null;
}
