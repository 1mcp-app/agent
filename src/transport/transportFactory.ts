import path from 'path';

import { SSEClientTransport, SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { OAuthClientConfig, SDKOAuthClientProvider } from '@src/auth/sdkOAuthClientProvider.js';
import { processEnvironment, substituteEnvVars } from '@src/config/envProcessor.js';
import { AUTH_CONFIG, MCP_SERVER_VERSION } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { AuthProviderTransport, MCPServerParams, transportConfigSchema } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { HandlebarsTemplateRenderer } from '@src/template/handlebarsTemplateRenderer.js';
import type { ContextData } from '@src/types/context.js';

import { z, ZodError } from 'zod';

import { ManagedStdioStderr } from './managedStdioStderr.js';
import { RestartableStdioTransport } from './restartableStdioTransport.js';

type ValidatedTransport = z.infer<typeof transportConfigSchema>;

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
function createOAuthProvider(name: string, validatedTransport: ValidatedTransport): SDKOAuthClientProvider {
  const configManager = AgentConfigManager.getInstance();

  const oauthConfig: OAuthClientConfig = {
    autoRegister: true,
    redirectUrl: `${configManager.getUrl()}${AUTH_CONFIG.CLIENT.OAUTH.DEFAULT_CALLBACK_PATH}/${name}`,
    ...validatedTransport.oauth,
  };

  // Derive client session storage path from server session storage path
  // This ensures config-dir isolation applies to client sessions as well
  let clientSessionPath: string | undefined;
  const serverSessionPath = configManager.get('auth').sessionStoragePath;
  if (serverSessionPath) {
    // If server uses custom session path, derive client path from the same parent
    // e.g., if server uses '.tmp-test/sessions', client uses '.tmp-test/clientSessions'
    const parentDir = path.dirname(serverSessionPath);
    clientSessionPath = path.join(parentDir, 'clientSessions');
  }

  logger.info(`Creating OAuth client provider for transport: ${name}`);
  return new SDKOAuthClientProvider(name, oauthConfig, clientSessionPath);
}

function substituteStringRecord(
  values: Record<string, string> | undefined,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> | undefined {
  if (!values) {
    return undefined;
  }

  const substituted: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    substituted[key] = substituteEnvVars(value, env);
  }
  return substituted;
}

function withTransportEnvSubstitution(validatedTransport: ValidatedTransport): ValidatedTransport {
  if (!AgentConfigManager.getInstance().isEnvSubstitutionEnabled()) {
    return validatedTransport;
  }

  let oauth = validatedTransport.oauth;
  if (oauth) {
    oauth = { ...oauth };
    if (oauth.clientId) {
      oauth.clientId = substituteEnvVars(oauth.clientId);
    }
    if (oauth.clientSecret) {
      oauth.clientSecret = substituteEnvVars(oauth.clientSecret);
    }
    if (oauth.redirectUrl) {
      oauth.redirectUrl = substituteEnvVars(oauth.redirectUrl);
    }
    if (oauth.scopes) {
      oauth.scopes = oauth.scopes.map((scope) => substituteEnvVars(scope));
    }
  }

  return {
    ...validatedTransport,
    url: validatedTransport.url ? substituteEnvVars(validatedTransport.url) : validatedTransport.url,
    headers: substituteStringRecord(validatedTransport.headers),
    oauth,
  };
}

/**
 * Creates SSE transport with OAuth provider
 */
function createSSETransport(name: string, validatedTransport: ValidatedTransport): AuthProviderTransport {
  validatedTransport = withTransportEnvSubstitution(validatedTransport);

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
function createHTTPTransport(name: string, validatedTransport: ValidatedTransport): AuthProviderTransport {
  validatedTransport = withTransportEnvSubstitution(validatedTransport);

  if (!validatedTransport.url) {
    throw new Error(`URL is required for HTTP transport: ${name}`);
  }

  const httpOptions: StreamableHTTPClientTransportOptions = {
    requestInit: {
      headers: {
        ...validatedTransport.headers,
        'User-Agent': `1MCP/${MCP_SERVER_VERSION}`,
      },
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
 * Creates stdio transport with enhanced environment processing and optional restart capability
 */
function createStdioTransport(name: string, validatedTransport: ValidatedTransport): AuthProviderTransport {
  if (!validatedTransport.command) {
    throw new Error(`Command is required for stdio transport: ${name}`);
  }

  const substituteEnv = AgentConfigManager.getInstance().isEnvSubstitutionEnabled();

  // Process environment variables with new features
  const envResult = processEnvironment({
    inheritParentEnv: validatedTransport.inheritParentEnv,
    envFilter: validatedTransport.envFilter,
    env: validatedTransport.env,
    substituteEnv,
  });

  debugIf(() => ({
    message: `Environment processing for ${name}:`,
    meta: {
      totalVariables: Object.keys(envResult.processedEnv).length,
      sdkDefaults: envResult.sources.sdkDefaults.length,
      inherited: envResult.sources.inherited.length,
      custom: envResult.sources.custom.length,
      filtered: envResult.sources.filtered.length,
    },
  }));

  const command = substituteEnv
    ? substituteEnvVars(validatedTransport.command, envResult.processedEnv)
    : validatedTransport.command;
  const args = substituteEnv
    ? validatedTransport.args?.map((arg) => substituteEnvVars(arg, envResult.processedEnv))
    : validatedTransport.args;
  const cwd =
    substituteEnv && validatedTransport.cwd
      ? substituteEnvVars(validatedTransport.cwd, envResult.processedEnv)
      : validatedTransport.cwd;

  const shouldManageStderr =
    validatedTransport.stderr === undefined ||
    validatedTransport.stderr === 'pipe' ||
    validatedTransport.stderr === 'overlapped';
  const managedStderr = shouldManageStderr ? new ManagedStdioStderr(name) : undefined;

  // Create SDK-compatible parameters with processed environment
  const stdioParams: StdioServerParameters = {
    command,
    args,
    stderr: validatedTransport.stderr ?? 'pipe',
    cwd,
    env: envResult.processedEnv,
  };

  // Create transport with restart capability if enabled
  if (validatedTransport.restartOnExit) {
    logger.info(`Creating restartable stdio transport for: ${name}`);
    const restartableTransport = new RestartableStdioTransport(
      stdioParams,
      {
        restartOnExit: true,
        maxRestarts: validatedTransport.maxRestarts, // Use config value or undefined for unlimited
        restartDelay: validatedTransport.restartDelay ?? 1000, // Use config value or default to 1 second
      },
      managedStderr,
    );

    // Add AuthProviderTransport properties
    return restartableTransport as unknown as AuthProviderTransport;
  }

  // Create standard stdio transport
  debugIf(`Creating standard stdio transport for: ${name}`);
  const transport = new StdioClientTransport(stdioParams);
  if (managedStderr) {
    managedStderr.attach(transport.stderr);
    const closeTransport = transport.close.bind(transport);
    transport.close = async (): Promise<void> => {
      try {
        await closeTransport();
      } finally {
        managedStderr.close();
      }
    };
  }
  return transport as AuthProviderTransport;
}

/**
 * Creates a single transport instance
 */
function createSingleTransport(name: string, validatedTransport: ValidatedTransport): AuthProviderTransport {
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
  validatedTransport: ValidatedTransport,
): void {
  transport.connectionTimeout = validatedTransport.connectionTimeout;
  transport.requestTimeout = validatedTransport.requestTimeout;
  transport.timeout = validatedTransport.timeout; // Keep for backward compatibility
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
      debugIf(`Skipping disabled transport: ${name}`);
      continue;
    }

    try {
      const inferredParams = inferTransportType(params, name);
      const validatedTransport = transportConfigSchema.parse(inferredParams);
      const transport = createSingleTransport(name, validatedTransport);

      assignTransport(transports, name, transport, validatedTransport);
      debugIf(`Created transport: ${name}`);
    } catch (error) {
      if (error instanceof ZodError) {
        logger.error(`Invalid transport configuration for ${name}:`, error.issues);
      } else {
        logger.error(`Error creating transport ${name}:`, error);
      }
      throw error;
    }
  }

  return transports;
}

/**
 * Creates transport instances from configuration with context-aware template processing
 * @param config - Configuration object with server parameters
 * @param context - Context data for template processing
 * @returns Record of transport instances
 */
export async function createTransportsWithContext(
  config: Record<string, MCPServerParams>,
  context?: ContextData,
): Promise<Record<string, AuthProviderTransport>> {
  const transports: Record<string, AuthProviderTransport> = {};

  // Create template renderer if context is provided
  const templateRenderer = context ? new HandlebarsTemplateRenderer() : null;

  for (const [name, params] of Object.entries(config)) {
    if (params.disabled) {
      debugIf(`Skipping disabled transport: ${name}`);
      continue;
    }

    try {
      let processedParams = inferTransportType(params, name);

      // Process templates if context is provided
      if (templateRenderer && context) {
        debugIf(() => ({
          message: 'Processing templates for server',
          meta: { serverName: name },
        }));

        processedParams = templateRenderer.renderTemplate(processedParams, context);

        debugIf(() => ({
          message: 'Templates processed successfully',
          meta: { serverName: name },
        }));
      }

      const validatedTransport = transportConfigSchema.parse(processedParams);
      const transport = createSingleTransport(name, validatedTransport);

      assignTransport(transports, name, transport, validatedTransport);
      debugIf(`Created transport: ${name}`);
    } catch (error) {
      if (error instanceof ZodError) {
        logger.error(`Invalid transport configuration for ${name}:`, error.issues);
      } else {
        logger.error(`Error creating transport ${name}:`, error);
      }
      throw error;
    }
  }

  return transports;
}
