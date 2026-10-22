import path from 'node:path';

import { canonicalLifecyclePath } from '@src/application/projectLifecycle.js';
import { isLoopbackHost } from '@src/commands/serve/templateContextTrust.js';
import { resolveAgentSessionOptions } from '@src/commands/shared/agentSession.js';
import {
  isProjectOwnerEnded,
  type ProjectOwnerTarget,
  readProjectOwnerTargets,
} from '@src/commands/shared/projectOwnerStore.js';
import { buildServerUrl, type ServeUrlOptions } from '@src/commands/shared/serveClient.js';
import { normalizeTags, type ResolvedProjectContext, resolveProjectContext } from '@src/config/projectConfigLoader.js';
import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import { getConfigDir } from '@src/constants.js';
import {
  canonicalizeCheckoutPath,
  loadProjectSet,
  resolveProjectSelection,
} from '@src/domains/project-selection/projectSelection.js';
import {
  type RuntimeIdentityWarning,
  type RuntimeTargetTlsOptions,
  verifyRuntimeIdentityForTarget,
} from '@src/domains/runtime-targets/runtimeIdentityVerification.js';
import {
  localRuntimeStatusCommand,
  RuntimeProbeError,
  runtimeTargetVerifyCommand,
} from '@src/domains/runtime-targets/runtimeProbe.js';
import {
  assertRuntimeTargetConfigDirAllowed,
  normalizeRuntimeTargetUrl,
  type RuntimeTargetListEntry,
  RuntimeTargetStore,
  RuntimeTargetStoreError,
} from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import type { ProjectSet } from '@src/types/context.js';
import {
  discoverServerWithPidFile,
  toRuntimeProbeFailure,
  validateServer1mcpUrl,
} from '@src/utils/validation/urlDetection.js';

import type { ProjectSelectionOptions } from './projectSelectionOptions.js';

export interface ResolvableServeTargetOptions extends GlobalOptions, ProjectSelectionOptions, ServeUrlOptions {
  url?: string;
  context?: string;
}

export interface ResolvedServeTarget<TOptions extends ResolvableServeTargetOptions> {
  cwd: string;
  projectRoot: string;
  projectName: string;
  projectConfig: ProjectConfig | null;
  projectSet?: ProjectSet;
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
  localRuntimeScope?: {
    storagePath: string;
    runtimeScopeId?: string;
  };
  runtimeIdentityWarnings?: RuntimeIdentityWarning[];
}

export interface ServeTargetResolverPorts {
  /** Enabled only for agent MCP attachment, never runtime/config/auth management. */
  agentSession?: boolean;
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
  if (ports.agentSession && usesLocalAgentDefaults(options, ports)) {
    options = await resolveAgentSessionOptions(options);
  }
  const cleanup = await recordedCleanupTarget(options);
  const resolveCheckout = cleanup
    ? async (checkout: string) => {
        if (!cleanup.project.includes(checkout)) throw new Error('Cleanup path is not in the recorded selection');
        if (canonicalLifecyclePath(checkout) !== checkout) throw new Error('Recorded cleanup path was retargeted');
        return checkout;
      }
    : canonicalizeCheckoutPath;
  const projectSet = options['project-set']
    ? await loadProjectSet(options['project-set'], options.project, resolveCheckout)
    : undefined;
  const selected = projectSet ? resolveProjectSelection({ project: {}, projectSet }) : undefined;
  if (!projectSet && options.project && options.project.length !== 1) {
    throw new Error('Without --project-set, --project accepts exactly one checkout path');
  }
  let checkoutPath: string | undefined;
  if (selected?.kind === 'single') {
    checkoutPath = selected.projects[0].path;
  } else if (!projectSet && options.project?.[0]) {
    checkoutPath = await resolveCheckout(options.project[0], process.cwd());
  }
  const resolvedProjectContext: ResolvedProjectContext = cleanup
    ? {
        cwd: checkoutPath ?? cleanup.project[0],
        projectRoot: checkoutPath ?? cleanup.project[0],
        projectName: path.basename(checkoutPath ?? cleanup.project[0]),
        projectConfig: null,
        source: 'cwd',
      }
    : await resolveProjectContext(checkoutPath);
  const selectedProjectConfig = projectSet && selected?.kind !== 'single' ? null : resolvedProjectContext.projectConfig;
  const normalizedOptions = normalizeEphemeralUrlOption(options);
  const mergedOptions = mergeServeTargetOptions(normalizedOptions, selectedProjectConfig);

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
      throw new RuntimeProbeError(toRuntimeProbeFailure(validation, discoveredUrl), {
        targetKind: 'remote',
        targetName: remoteTarget.name,
        recoveryCommand: runtimeTargetVerifyCommand(remoteTarget.name),
      });
    }

    return {
      cwd: resolvedProjectContext.cwd,
      projectRoot: resolvedProjectContext.projectRoot,
      projectName: resolvedProjectContext.projectName,
      projectConfig: selectedProjectConfig,
      projectSet,
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

  const localDiscovery = await discoverServerWithPidFile(mergedOptions['config-dir'], mergedOptions.url);
  const { url: discoveredUrl, pid: serverPid, source, validated, runtimeIdentity } = localDiscovery;
  const validation = validated ? undefined : await validateServer1mcpUrl(discoveredUrl);

  if (validation && !validation.valid) {
    const isEphemeral = Boolean(mergedOptions.url);
    throw new RuntimeProbeError(toRuntimeProbeFailure(validation, discoveredUrl), {
      targetKind: isEphemeral ? 'ephemeral' : 'local',
      ...(!isEphemeral && serverPid !== undefined ? { pid: serverPid } : {}),
      ...(!isEphemeral
        ? {
            configDir: mergedOptions['config-dir'],
            recoveryCommand: localRuntimeStatusCommand(mergedOptions['config-dir']),
          }
        : {}),
    });
  }

  const isExplicitLocalContext = !mergedOptions.url && mergedOptions.context === 'local';
  const candidateRuntimeIdentity = runtimeIdentity ?? validation?.identity;
  const localRuntimeIdentity =
    isExplicitLocalContext && candidateRuntimeIdentity
      ? await (ports.verifyRuntimeIdentity ?? verifyRuntimeIdentityForTarget)({
          target: {
            name: 'local',
            url: withoutMcpSuffix(discoveredUrl),
            observedIdentity: undefined,
          },
          candidateIdentity: candidateRuntimeIdentity,
        })
      : undefined;

  return {
    cwd: resolvedProjectContext.cwd,
    projectRoot: resolvedProjectContext.projectRoot,
    projectName: resolvedProjectContext.projectName,
    projectConfig: selectedProjectConfig,
    projectSet,
    mergedOptions,
    discoveredUrl,
    serverUrl: buildServerUrl(discoveredUrl, mergedOptions),
    serverPid,
    source,
    projectContextSource: resolvedProjectContext.source,
    runtimeTargetContext: isExplicitLocalContext
      ? {
          name: 'local',
          kind: 'local',
          runtimeScopeId: localRuntimeIdentity?.identity.runtimeScopeId,
        }
      : undefined,
    localRuntimeScope: {
      storagePath: getConfigDir(mergedOptions['config-dir']),
      runtimeScopeId: localRuntimeIdentity?.identity.runtimeScopeId,
    },
    runtimeIdentityWarnings: localRuntimeIdentity?.warnings,
  };
}

/** Missing checkouts are accepted only for the exact persisted terminal release selection. */
async function recordedCleanupTarget(options: ResolvableServeTargetOptions): Promise<ProjectOwnerTarget | undefined> {
  if (!('terminal-cleanup' in options) || options['terminal-cleanup'] !== true) return undefined;
  if (!('action' in options) || options.action !== 'release') throw new Error('Recorded cleanup only supports release');
  const ownerFile = options['project-owner'];
  const scope = 'expected-runtime-scope' in options ? options['expected-runtime-scope'] : undefined;
  if (!ownerFile || typeof scope !== 'string') throw new Error('Recorded cleanup requires owner and runtime identity');
  if (!(await isProjectOwnerEnded(ownerFile))) throw new Error('Recorded cleanup requires verified terminal evidence');
  const targets = await readProjectOwnerTargets(ownerFile);
  for (const target of targets) {
    if (target.runtimeScopeId !== scope) continue;
    if (target['config-dir'] !== options['config-dir']) continue;
    if (target['project-set'] !== options['project-set']) continue;
    if (target['project-set']) {
      if (options.project) continue;
    } else if (JSON.stringify(target.project) !== JSON.stringify(options.project)) continue;
    if (target.config !== options.config) continue;
    if (target.context !== options.context) continue;
    if (target.url !== options.url) continue;
    return target;
  }
  throw new Error('Cleanup selectors do not match a recorded owner target');
}

export function usesLocalAgentDefaults(
  options: ResolvableServeTargetOptions,
  ports: ServeTargetResolverPorts = {},
): boolean {
  if (options.url) {
    if (!options['project-owner']) return false;
    return isLoopbackHost(new URL(options.url).hostname);
  }
  if (options.context === 'local') return true;
  const store = ports.runtimeTargetStore ?? new RuntimeTargetStore();
  if (store.resolveForConnection) return store.resolveForConnection(options.context).name === 'local';
  if (options.context) return store.inspect(options.context).name === 'local';
  return store.current().name === 'local';
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
