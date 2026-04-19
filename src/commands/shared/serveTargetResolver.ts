import { buildServerUrl, type ServeUrlOptions } from '@src/commands/shared/serveClient.js';
import { loadProjectConfig, normalizeTags } from '@src/config/projectConfigLoader.js';
import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

export interface ResolvableServeTargetOptions extends GlobalOptions, ServeUrlOptions {
  url?: string;
}

export interface ResolvedServeTarget<TOptions extends ResolvableServeTargetOptions> {
  projectConfig: ProjectConfig | null;
  mergedOptions: TOptions;
  discoveredUrl: string;
  serverUrl: URL;
  serverPid?: number;
  source: 'user' | 'pidfile' | 'portscan';
}

export function mergeServeTargetOptions<TOptions extends ResolvableServeTargetOptions>(
  options: TOptions,
  projectConfig: ProjectConfig | null,
): TOptions {
  return {
    ...options,
    preset: options.preset || projectConfig?.preset,
    filter: options.filter || projectConfig?.filter,
    tags: options.tags || normalizeTags(projectConfig?.tags),
  };
}

export async function resolveServeTarget<TOptions extends ResolvableServeTargetOptions>(
  options: TOptions,
): Promise<ResolvedServeTarget<TOptions>> {
  const projectConfig = await loadProjectConfig();
  const mergedOptions = mergeServeTargetOptions(options, projectConfig);
  const {
    url: discoveredUrl,
    pid: serverPid,
    source,
  } = await discoverServerWithPidFile(mergedOptions['config-dir'], mergedOptions.url);
  const validation = await validateServer1mcpUrl(discoveredUrl);

  if (!validation.valid) {
    throw new Error(validation.error || 'Cannot connect to the running 1MCP server.');
  }

  return {
    projectConfig,
    mergedOptions,
    discoveredUrl,
    serverUrl: buildServerUrl(discoveredUrl, mergedOptions),
    serverPid,
    source,
  };
}
