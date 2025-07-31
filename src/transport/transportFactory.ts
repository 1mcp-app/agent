import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport, SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ZodError } from 'zod';
import logger from '../logger/logger.js';
import { AuthProviderTransport, transportConfigSchema } from '../core/types/index.js';
import { MCPServerParams } from '../core/types/index.js';
import { OAuthClientConfig, SDKOAuthClientProvider } from '../auth/sdkOAuthClientProvider.js';
import { AUTH_CONFIG } from '../constants.js';
import { AgentConfigManager } from '../core/server/agentConfig.js';

/**
 * Infers transport type from configuration parameters
 */
export function inferTransportType(params: MCPServerParams, name: string): MCPServerParams {
  const inferredParams = { ...params };

  if (inferredParams.type) {
    return inferredParams;
  }

  logger.warn(`Transport type is missing for ${name}, inferring type...`);

  if (inferredParams.command) {
    inferredParams.type = 'stdio';
    logger.info(`Inferred transport type for ${name} as stdio`);
  } else if (inferredParams.url) {
    if (inferredParams.url.endsWith('mcp')) {
      inferredParams.type = 'http';
      logger.info(`Inferred transport type for ${name} as http/streamableHttp`);
    } else {
      inferredParams.type = 'sse';
      logger.info(`Inferred transport type for ${name} as sse`);
    }
  }

  return inferredParams;
}

/**
 * Creates OAuth provider for HTTP-based transports
 */
function createOAuthProvider(
  name: string,
  validatedTransport: typeof transportConfigSchema._type,
): SDKOAuthClientProvider {
  const configManager = AgentConfigManager.getInstance();

  const oauthConfig: OAuthClientConfig = {
    autoRegister: true,
    redirectUrl: `${configManager.getUrl()}${AUTH_CONFIG.CLIENT.OAUTH.DEFAULT_CALLBACK_PATH}/${name}`,
    ...validatedTransport.oauth,
  };

  logger.info(`Creating OAuth client provider for transport: ${name}`);
  return new SDKOAuthClientProvider(name, oauthConfig);
}

/**
 * Creates SSE transport with OAuth provider
 */
function createSSETransport(
  name: string,
  validatedTransport: typeof transportConfigSchema._type,
): AuthProviderTransport {
  if (!validatedTransport.url) {
    throw new Error(`URL is required for SSE transport: ${name}`);
  }

  const sseOptions: SSEClientTransportOptions = {
    requestInit: {
      headers: validatedTransport.headers,
    },
  };

  const oauthProvider = createOAuthProvider(name, validatedTransport);
  sseOptions.authProvider = oauthProvider;

  const transport = new SSEClientTransport(new URL(validatedTransport.url), sseOptions) as AuthProviderTransport;
  transport.oauthProvider = oauthProvider;

  return transport;
}

/**
 * Creates HTTP transport with OAuth provider
 */
function createHTTPTransport(
  name: string,
  validatedTransport: typeof transportConfigSchema._type,
): AuthProviderTransport {
  if (!validatedTransport.url) {
    throw new Error(`URL is required for HTTP transport: ${name}`);
  }

  const httpOptions: StreamableHTTPClientTransportOptions = {
    requestInit: {
      headers: validatedTransport.headers,
    },
  };

  const oauthProvider = createOAuthProvider(name, validatedTransport);
  httpOptions.authProvider = oauthProvider;

  const transport = new StreamableHTTPClientTransport(
    new URL(validatedTransport.url),
    httpOptions,
  ) as AuthProviderTransport;
  transport.oauthProvider = oauthProvider;

  return transport;
}

/**
 * Creates stdio transport
 */
function createStdioTransport(
  name: string,
  validatedTransport: typeof transportConfigSchema._type,
): AuthProviderTransport {
  if (!validatedTransport.command) {
    throw new Error(`Command is required for stdio transport: ${name}`);
  }

  return new StdioClientTransport(validatedTransport as StdioServerParameters) as AuthProviderTransport;
}

/**
 * Creates a single transport instance
 */
function createSingleTransport(
  name: string,
  validatedTransport: typeof transportConfigSchema._type,
): AuthProviderTransport {
  switch (validatedTransport.type) {
    case 'sse':
      return createSSETransport(name, validatedTransport);
    case 'http':
    case 'streamableHttp':
      return createHTTPTransport(name, validatedTransport);
    case 'stdio':
      return createStdioTransport(name, validatedTransport);
    default:
      throw new Error(`Invalid transport type: ${validatedTransport.type}`);
  }
}

/**
 * Assigns transport properties and adds to collection
 */
function assignTransport(
  transports: Record<string, AuthProviderTransport>,
  name: string,
  transport: AuthProviderTransport,
  validatedTransport: typeof transportConfigSchema._type,
): void {
  transport.timeout = validatedTransport.timeout;
  transport.tags = validatedTransport.tags;
  transports[name] = transport;
}

/**
 * Creates transport instances from configuration
 * @param config - Configuration object with server parameters
 * @returns Record of transport instances
 */
export function createTransports(config: Record<string, MCPServerParams>): Record<string, AuthProviderTransport> {
  const transports: Record<string, AuthProviderTransport> = {};

  for (const [name, params] of Object.entries(config)) {
    if (params.disabled) {
      logger.debug(`Skipping disabled transport: ${name}`);
      continue;
    }

    try {
      const inferredParams = inferTransportType(params, name);
      const validatedTransport = transportConfigSchema.parse(inferredParams);
      const transport = createSingleTransport(name, validatedTransport);

      assignTransport(transports, name, transport, validatedTransport);
      logger.debug(`Created transport: ${name}`);
    } catch (error) {
      if (error instanceof ZodError) {
        logger.error(`Invalid transport configuration for ${name}:`, error.errors);
      } else {
        logger.error(`Error creating transport ${name}:`, error);
      }
      throw error;
    }
  }

  return transports;
}
