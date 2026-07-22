import { buildServerUrl, type ServeUrlOptions } from '@src/commands/shared/serveClient.js';
import { normalizeTags, resolveProjectContext } from '@src/config/projectConfigLoader.js';
import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import {
  type RuntimeIdentityWarning,
  type RuntimeTargetTlsOptions,
  verifyRuntimeIdentityForTarget,
} from '@src/domains/runtime-targets/runtimeIdentityVerification.js';
import {
  assertRuntimeTargetConfigDirAllowed,
  normalizeRuntimeTargetUrl,
  type RuntimeTargetListEntry,
  RuntimeTargetStore,
  RuntimeTargetStoreError,
} from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

export interface ResolvableServeTargetOptions extends GlobalOptions, ServeUrlOptions {
  url?: string;
  context?: string;
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
  runtimeTargetContext?: {
    name: string;
    kind: 'local' | 'remote';
    runtimeScopeId?: string;
  };
  runtimeIdentityWarnings?: RuntimeIdentityWarning[];
}

export interface ServeTargetResolverPorts {
  runtimeTargetStore?: Pick<
    RuntimeTargetStore,
    'current' | 'inspect' | 'requireInsecureTlsConfirmation' | 'updateObservedIdentityMetadata'
  > &
    Partial<Pick<RuntimeTargetStore, 'resolveForConnection'>>;
  verifyRuntimeIdentity?: typeof verifyRuntimeIdentityForTarget;
}

export function mergeServeTargetOptions<TOptions extends ResolvableServeTargetOptions>(
  options: TOptions,
  projectConfig: ProjectConfig | null,
): TOptions {
  const explicitSelectorInput = collectFilterInput(options);
  const projectSelectorInput = selectOneFilterInput({
    preset: projectConfig?.preset,
    filter: projectConfig?.filter,
    tags: normalizeTags(projectConfig?.tags),
  });
  const selectorInput = explicitSelectorInput.hasAnySelector ? explicitSelectorInput : projectSelectorInput;

  return {
    ...options,
    preset: selectorInput.preset,
    filter: selectorInput.filter,
    tags: selectorInput.tags,
    'tag-filter': selectorInput['tag-filter'],
  };
}

function collectFilterInput(options: ServeUrlOptions): ServeUrlOptions & { hasAnySelector: boolean } {
  const hasPreset = options.preset !== undefined;
  const hasTagFilter = options['tag-filter'] !== undefined;
  const hasFilter = options.filter !== undefined;
  const hasTags = options.tags !== undefined;
  const hasAnySelector = hasPreset || hasTagFilter || hasFilter || hasTags;

  return {
    hasAnySelector,
    preset: options.preset,
    'tag-filter': options['tag-filter'],
    filter: options.filter,
    tags: options.tags,
  };
}

function selectOneFilterInput(options: ServeUrlOptions): ServeUrlOptions & { hasAnySelector: boolean } {
  const collected = collectFilterInput(options);
  const { hasAnySelector } = collected;

  if (!hasAnySelector) {
    return { hasAnySelector };
  }

  if (collected.preset !== undefined) {
    return { hasAnySelector, preset: collected.preset };
  }
  if (collected['tag-filter'] !== undefined) {
    return { hasAnySelector, 'tag-filter': collected['tag-filter'] };
  }
  if (collected.filter !== undefined) {
    return { hasAnySelector, filter: collected.filter };
  }
  return { hasAnySelector, tags: collected.tags };
}

export async function resolveServeTarget<TOptions extends ResolvableServeTargetOptions>(
  options: TOptions,
  ports: ServeTargetResolverPorts = {},
): Promise<ResolvedServeTarget<TOptions>> {
  if (options.url && options.context) {
    throw new RuntimeTargetStoreError(
      'target_selector_conflict',
      'Use either --url or --context, not both, when selecting a runtime target',
    );
  }
  const resolvedProjectContext = await resolveProjectContext();
  const normalizedOptions = normalizeEphemeralUrlOption(options);
  const mergedOptions = mergeServeTargetOptions(normalizedOptions, resolvedProjectContext.projectConfig);

  const remoteTarget = await resolveRemoteRuntimeTargetContext(mergedOptions, ports);
  if (remoteTarget) {
    const discoveredUrl = withMcpSuffix(remoteTarget.url);
    const tlsOptions = targetTlsOptions({
      caFile: remoteTarget.caFile,
      insecureSkipVerify: remoteTarget.insecureSkipVerify,
    });
    const validation = tlsOptions
      ? await validateServer1mcpUrl(discoveredUrl, tlsOptions)
      : await validateServer1mcpUrl(discoveredUrl);

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
      source: 'user',
      projectContextSource: resolvedProjectContext.source,
      runtimeTargetContext: {
        name: remoteTarget.name,
        kind: 'remote',
        runtimeScopeId: remoteTarget.observedIdentity?.runtimeScopeId,
      },
      runtimeIdentityWarnings: remoteTarget.runtimeIdentityWarnings,
    };
  }

  const localDiscovery =
    mergedOptions.context === 'local'
      ? await discoverServerWithPidFile(mergedOptions['config-dir'], mergedOptions.url, {
          failOnOwnedRuntimeUnavailable: true,
        })
      : await discoverServerWithPidFile(mergedOptions['config-dir'], mergedOptions.url);
  const { url: discoveredUrl, pid: serverPid, source } = localDiscovery;
  const validation = await validateServer1mcpUrl(discoveredUrl);

  if (!validation.valid) {
    throw new Error(validation.error || 'Cannot connect to the running 1MCP server.');
  }

  let localRuntimeIdentity: Awaited<ReturnType<typeof verifyRuntimeIdentityForTarget>> | undefined;
  if (!mergedOptions.url && mergedOptions.context === 'local') {
    try {
      localRuntimeIdentity = await (ports.verifyRuntimeIdentity ?? verifyRuntimeIdentityForTarget)({
        target: {
          name: 'local',
          url: withoutMcpSuffix(discoveredUrl),
          observedIdentity: undefined,
        },
      });
    } catch (error) {
      if (mergedOptions.context === 'local') {
        throw error;
      }
    }
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
    runtimeTargetContext: localRuntimeIdentity
      ? {
          name: 'local',
          kind: 'local',
          runtimeScopeId: localRuntimeIdentity.identity.runtimeScopeId,
        }
      : undefined,
    runtimeIdentityWarnings: localRuntimeIdentity?.warnings,
  };
}

async function resolveRemoteRuntimeTargetContext<TOptions extends ResolvableServeTargetOptions>(
  options: TOptions,
  ports: ServeTargetResolverPorts,
): Promise<(RuntimeTargetListEntry & { url: string; runtimeIdentityWarnings?: RuntimeIdentityWarning[] }) | null> {
  if (options.url) {
    return null;
  }

  const store = ports.runtimeTargetStore ?? new RuntimeTargetStore();
  const target = store.resolveForConnection
    ? store.resolveForConnection(options.context)
    : options.context
      ? store.inspect(options.context)
      : store.current();

  if (target.name === 'local') {
    return null;
  }

  assertRuntimeTargetConfigDirAllowed({
    command: 'verify',
    targetName: target.name,
    configDir: options['config-dir'],
  });

  if (target.kind !== 'remote' || !target.url) {
    throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${target.name}" was not found`);
  }
  store.requireInsecureTlsConfirmation({
    name: target.name,
    operation: 'credentialed-attach',
  });
  const remoteTarget = { ...target, url: target.url };

  const verifyRuntimeIdentity = ports.verifyRuntimeIdentity ?? verifyRuntimeIdentityForTarget;
  const verification = await verifyRuntimeIdentity({
    target: {
      name: remoteTarget.name,
      url: remoteTarget.url,
      caFile: remoteTarget.caFile,
      insecureSkipVerify: remoteTarget.insecureSkipVerify,
      observedIdentity: remoteTarget.observedIdentity,
    },
  });
  store.updateObservedIdentityMetadata(remoteTarget.name, verification.identity);

  return {
    ...remoteTarget,
    observedIdentity: verification.identity,
    runtimeIdentityWarnings: verification.warnings,
  };
}

function withMcpSuffix(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  const normalized = parsed.toString().replace(/\/$/, '');
  return normalized.endsWith('/mcp') ? normalized : `${normalized}/mcp`;
}

function withoutMcpSuffix(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  const normalized = parsed.toString().replace(/\/$/, '');
  return normalized.endsWith('/mcp') ? normalized.slice(0, -4) : normalized;
}

function targetTlsOptions(tls: RuntimeTargetTlsOptions): RuntimeTargetTlsOptions | undefined {
  return tls.caFile || tls.insecureSkipVerify
    ? {
        ...(tls.caFile ? { caFile: tls.caFile } : {}),
        ...(tls.insecureSkipVerify ? { insecureSkipVerify: true } : {}),
      }
    : undefined;
}

function normalizeEphemeralUrlOption<TOptions extends ResolvableServeTargetOptions>(options: TOptions): TOptions {
  if (!options.url) {
    return options;
  }
  const normalizedUrl = normalizeRuntimeTargetUrl(options.url);
  return {
    ...options,
    url: withMcpSuffix(normalizedUrl),
  };
}
