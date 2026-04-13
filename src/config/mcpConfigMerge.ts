import { GLOBAL_TRANSPORT_CONFIG_KEYS, GlobalTransportConfig, MCPServerParams } from '@src/core/types/transport.js';

const GLOBAL_KEY_SET = new Set<string>(GLOBAL_TRANSPORT_CONFIG_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

/**
 * Return unknown keys defined under the raw global section.
 */
export function getUnknownGlobalConfigKeys(rawGlobal: unknown): string[] {
  if (!isRecord(rawGlobal)) {
    return [];
  }

  return Object.keys(rawGlobal).filter((key) => !GLOBAL_KEY_SET.has(key));
}

/**
 * Merge global shareable settings with a single server configuration.
 * Server-specific values always take precedence.
 */
export function mergeGlobalAndServerConfig(
  globalConfig: GlobalTransportConfig | undefined,
  serverConfig: MCPServerParams,
): MCPServerParams {
  if (!globalConfig) {
    return { ...serverConfig };
  }

  const merged: MCPServerParams = { ...serverConfig };

  // Primitive fallback values
  if (merged.timeout === undefined && globalConfig.timeout !== undefined) {
    merged.timeout = globalConfig.timeout;
  }
  if (merged.connectionTimeout === undefined && globalConfig.connectionTimeout !== undefined) {
    merged.connectionTimeout = globalConfig.connectionTimeout;
  }
  if (merged.requestTimeout === undefined && globalConfig.requestTimeout !== undefined) {
    merged.requestTimeout = globalConfig.requestTimeout;
  }
  if (merged.inheritParentEnv === undefined && globalConfig.inheritParentEnv !== undefined) {
    merged.inheritParentEnv = globalConfig.inheritParentEnv;
  }
  if (merged.envFilter === undefined && globalConfig.envFilter !== undefined) {
    merged.envFilter = globalConfig.envFilter;
  }

  // Replace semantics
  if (merged.oauth === undefined && globalConfig.oauth !== undefined) {
    merged.oauth = globalConfig.oauth;
  }
  if (merged.headers === undefined && globalConfig.headers !== undefined) {
    merged.headers = globalConfig.headers;
  }

  // env uses merge semantics when both sides are object form
  if (merged.env === undefined && globalConfig.env !== undefined) {
    merged.env = globalConfig.env;
  } else if (isStringRecord(globalConfig.env) && isStringRecord(merged.env)) {
    merged.env = { ...globalConfig.env, ...merged.env };
  }

  // Global headers should only apply to HTTP/SSE transports.
  if (merged.type === 'stdio' && globalConfig.headers !== undefined && serverConfig.headers === undefined) {
    delete merged.headers;
  }

  // Global inheritParentEnv should only apply to stdio transports.
  if (
    (merged.type === 'http' || merged.type === 'sse' || merged.type === 'streamableHttp') &&
    globalConfig.inheritParentEnv !== undefined &&
    serverConfig.inheritParentEnv === undefined
  ) {
    delete merged.inheritParentEnv;
  }
  if (
    (merged.type === 'http' || merged.type === 'sse' || merged.type === 'streamableHttp') &&
    globalConfig.envFilter !== undefined &&
    serverConfig.envFilter === undefined
  ) {
    delete merged.envFilter;
  }

  return merged;
}

/**
 * Merge global shareable settings with all servers.
 */
export function mergeGlobalWithServers(
  globalConfig: GlobalTransportConfig | undefined,
  servers: Record<string, MCPServerParams>,
): Record<string, MCPServerParams> {
  const mergedServers: Record<string, MCPServerParams> = {};

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    mergedServers[serverName] = mergeGlobalAndServerConfig(globalConfig, serverConfig);
  }

  return mergedServers;
}
