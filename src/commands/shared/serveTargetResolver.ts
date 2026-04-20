import { buildServerUrl, type ServeUrlOptions } from '@src/commands/shared/serveClient.js';
import { normalizeTags, resolveProjectContext } from '@src/config/projectConfigLoader.js';
import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

export interface ResolvableServeTargetOptions extends GlobalOptions, ServeUrlOptions {
  url?: string;
}

export interface ResolvedServeTarget<TOptions extends ResolvableServeTargetOptions> {
  cwd: string;
  projectRoot: string;
  projectName: string;
  projectConfig: ProjectConfig | null;
  mergedOptions: TOptions;
  discoveredUrl: string;
  serverUrl: URL;
  serverPid?: number;
  source: 'user' | 'pidfile' | 'portscan';
  projectContextSource: 'project-config' | 'repo-root' | 'cwd';
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
  const resolvedProjectContext = await resolveProjectContext();
  const mergedOptions = mergeServeTargetOptions(options, resolvedProjectContext.projectConfig);
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
    cwd: resolvedProjectContext.cwd,
    projectRoot: resolvedProjectContext.projectRoot,
    projectName: resolvedProjectContext.projectName,
    projectConfig: resolvedProjectContext.projectConfig,
    mergedOptions,
    discoveredUrl,
    serverUrl: buildServerUrl(discoveredUrl, mergedOptions),
    serverPid,
    source,
    projectContextSource: resolvedProjectContext.source,
  };
}
