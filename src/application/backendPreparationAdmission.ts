import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { ConfigManager } from '@src/config/configManager.js';
import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { MCP_URI_SEPARATOR } from '@src/constants.js';
import type { ToolDispatchDecision } from '@src/core/capabilities/capabilityCatalog.js';
import { ToolInvokeInputSchema } from '@src/core/capabilities/schemas/metaToolSchemas.js';
import {
  getProjectPreparationAuthorityIdentity,
  validateProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import { TemplateFilteringService } from '@src/core/filtering/templateFilteringService.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { getDisabledSourceToolError } from '@src/core/server/disabledTools.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import { admitToolSchemas, prepareToolValidation } from '@src/core/validation/toolSchemaBoundary.js';
import { requiresCodeGraphPreparation } from '@src/domains/backend-preparation/codegraphAdapter.js';
import { getCodeGraphPreparationToolDefinition } from '@src/domains/backend-preparation/codegraphReadOnly.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { projectToolArguments } from '@src/domains/project-selection/projectPolicy.js';
import { isProjectBackendVisible, resolveProjectPolicies } from '@src/domains/project-selection/projectPolicy.js';
import { requireProjectTarget } from '@src/domains/project-selection/projectSelection.js';

import {
  type BackendPreparationCoordinator,
  getBackendPreparationCoordinator,
  PreparationAuthorizationChangedError,
  refreshPreparedBackendCapabilities,
} from './backendPreparationCoordinator.js';

interface PreparationRequestScope {
  expiresAt: number;
  ownerSessionId?: string;
  filterConfig?: InboundConnectionConfig;
  authentication?: readonly unknown[];
  revalidateAuth?: () => boolean | Promise<boolean>;
}
const requestScopes = new AsyncLocalStorage<PreparationRequestScope>();

class PreparationCallerStopped extends Error {
  constructor(readonly reason: 'inspection_timeout' | 'caller_disconnected') {
    super(reason);
  }
}

async function withinRequestBudget<T>(
  scope: PreparationRequestScope,
  signal: AbortSignal | undefined,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const remaining = Math.max(0, scope.expiresAt - Date.now());
  if (signal?.aborted || remaining === 0)
    throw new PreparationCallerStopped(signal?.aborted ? 'caller_disconnected' : 'inspection_timeout');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStopped: (error: PreparationCallerStopped) => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectStopped = reject;
  });
  const stop = () => {
    controller.abort();
    rejectStopped(new PreparationCallerStopped('caller_disconnected'));
  };
  signal?.addEventListener('abort', stop, { once: true });
  timer = setTimeout(() => {
    controller.abort();
    rejectStopped(new PreparationCallerStopped('inspection_timeout'));
  }, remaining);
  try {
    return await Promise.race([Promise.resolve().then(() => action(controller.signal)), stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** Share only the request budget and caller identity. Every admission rechecks native readiness. */
export function withPreparationRequestScope<T>(
  input: Omit<PreparationRequestScope, 'expiresAt'>,
  operation: () => Promise<T>,
): Promise<T> {
  if (requestScopes.getStore()) return operation();
  const waitMs = ConfigManager.getInstance().getAppConfig?.().preparation?.requestWaitMs ?? 5000;
  return requestScopes.run({ ...input, expiresAt: Date.now() + waitMs }, operation);
}

/** Missing bearer credentials grant preparation only while runtime authentication is explicitly disabled. */
export function revalidatePreparationAuthentication(
  auth: object | undefined,
  revalidate: () => boolean | Promise<boolean>,
): Promise<boolean> {
  if (auth) return Promise.resolve(revalidate());
  return Promise.resolve(!AgentConfigManager.getInstance().isAuthEnabled());
}

/** Controls and tool admission expose handles to the same exact authorization owner. */
export function createPreparationOwnerIdentity(
  runtimeScopeId: string | undefined,
  authentication: readonly unknown[] | undefined,
  filter: InboundConnectionConfig,
): string {
  filter = normalizePreparationFilterConfig(filter);
  const selection = {
    tags: filter.tags,
    tagExpression: filter.tagExpression,
    tagFilterMode: filter.tagFilterMode,
    tagQuery: filter.tagQuery,
    presetName: filter.presetName,
    projectFilterMode: filter.projectFilterMode ?? filter.tagFilterMode,
  };
  return createHash('sha256')
    .update(JSON.stringify([runtimeScopeId, authentication ?? 'verified-local-owner', selection]))
    .digest('hex');
}

function normalizePreparationFilterConfig(filter: InboundConnectionConfig): InboundConnectionConfig {
  if (filter.tagFilterMode === 'none' && filter.tags?.length) {
    return { ...filter, tagFilterMode: 'simple-or', projectFilterMode: filter.projectFilterMode ?? 'none' };
  }
  return filter;
}

export interface PreparationToolRequest {
  name: string;
  arguments?: unknown;
}
export interface PreparationToolAdmissionInput {
  serverManager: ServerManager | (() => ServerManager);
  bindingId?: string;
  ownerSessionId?: string;
  filterConfig: InboundConnectionConfig;
  authentication?: readonly unknown[];
  revalidateAuth: () => boolean | Promise<boolean>;
  request: PreparationToolRequest;
  signal?: AbortSignal;
}
export type PreparationToolAdmission =
  | { kind: 'unaffected' }
  | {
      kind: 'ready';
      setupDeadline: () => { signal: AbortSignal; stop: () => void };
      revalidate: () => Promise<boolean>;
      beforeDispatch: () => Promise<ToolDispatchDecision>;
    }
  | { kind: 'blocked'; result: ReturnType<typeof preparationToolResult> };

function preparationToolResult(preparation: unknown, server?: string, tool?: string) {
  const pending = { preparation, operationExecuted: false, operationQueued: false };
  const payload = server && tool ? { result: pending, server, tool } : pending;
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
}

function nativeTarget(request: PreparationToolRequest, backendNames: string[]) {
  if (request.name === 'tool_invoke') {
    const parsed = ToolInvokeInputSchema.safeParse(request.arguments);
    if (!parsed.success) return;
    return { backendName: parsed.data.server, toolName: parsed.data.toolName, arguments: parsed.data.args, meta: true };
  }
  const backendName = backendNames
    .sort((a, b) => b.length - a.length)
    .find((name) => request.name.startsWith(`${name}${MCP_URI_SEPARATOR}`));
  if (!backendName) return;
  return {
    backendName,
    toolName: request.name.slice(backendName.length + MCP_URI_SEPARATOR.length),
    arguments: request.arguments,
    meta: false,
  };
}

export async function admitBackendPreparationTool(
  input: PreparationToolAdmissionInput,
  ports: {
    coordinator?: Pick<BackendPreparationCoordinator, 'resolveGrant' | 'admit'>;
    toolDefinition?: typeof getCodeGraphPreparationToolDefinition;
    validateArguments?: (definition: Record<string, unknown>, args: unknown, signal?: AbortSignal) => Promise<void>;
    refresh?: typeof refreshPreparedBackendCapabilities;
  } = {},
): Promise<PreparationToolAdmission> {
  const configured = getConfiguredServerTargets();
  const candidate = nativeTarget(input.request, Object.keys(configured));
  if (
    !candidate ||
    configured[candidate.backendName]?.preparation?.adapter !== 'codegraph' ||
    !requiresCodeGraphPreparation(candidate.toolName)
  )
    return { kind: 'unaffected' };
  if (!requestScopes.getStore())
    return withPreparationRequestScope({}, () => admitBackendPreparationTool(input, ports));
  try {
    return await admitScopedPreparationTool(input, ports);
  } catch (error) {
    if (error instanceof PreparationAuthorizationChangedError)
      return { kind: 'blocked', result: preparationToolResult({ state: 'forbidden', instructions: error.message }) };
    if (!(error instanceof PreparationCallerStopped)) throw error;
    return {
      kind: 'blocked',
      result: preparationToolResult({
        state: 'unknown',
        reason: error.reason,
        instructions: 'Invoke again with a live caller and available inspection budget.',
      }),
    };
  }
}

async function admitScopedPreparationTool(
  input: PreparationToolAdmissionInput,
  ports: Parameters<typeof admitBackendPreparationTool>[1],
): Promise<PreparationToolAdmission> {
  const declared = ConfigManager.getInstance().loadDeclaredServerConfigs();
  const configs = { ...declared.staticServers, ...declared.templateServers };
  const target = nativeTarget(input.request, Object.keys(configs));
  if (!target) return { kind: 'unaffected' };
  const definition = configs[target.backendName];
  if (definition?.preparation?.adapter !== 'codegraph' || !requiresCodeGraphPreparation(target.toolName))
    return { kind: 'unaffected' };
  const preparationConfig = definition.preparation;
  const blocked = (preparation: unknown): PreparationToolAdmission => ({
    kind: 'blocked',
    result: preparationToolResult(
      preparation,
      target.meta ? target.backendName : undefined,
      target.meta ? target.toolName : undefined,
    ),
  });
  const scope = requestScopes.getStore()!;
  const filterConfig = normalizePreparationFilterConfig(scope.filterConfig ?? input.filterConfig);
  const presetRevision = filterConfig.presetName
    ? JSON.stringify(PresetManager.getInstance().getPreset(filterConfig.presetName))
    : undefined;
  const authentication = scope.authentication ?? input.authentication;
  const revalidateAuth = scope?.revalidateAuth ?? input.revalidateAuth;
  const ownerSessionId = scope?.ownerSessionId ?? input.ownerSessionId;
  const serverManager = typeof input.serverManager === 'function' ? input.serverManager() : input.serverManager;
  const manager = serverManager.getTemplateServerManager();
  const context = input.bindingId ? manager.getBindingContexts().get(input.bindingId) : undefined;
  const authority = input.bindingId ? manager.getBindingAuthority(input.bindingId) : undefined;
  if (input.bindingId && !context)
    return blocked({ state: 'forbidden', instructions: 'The selected request binding is no longer available.' });
  // Existing remote, legacy and STDIO query grants keep their normal dispatch path. They gain no local preparation reads or writes.
  if (!authority) return { kind: 'unaffected' };
  let authorityIdentity: string | undefined;
  try {
    authorityIdentity = getProjectPreparationAuthorityIdentity(authority, context!);
  } catch {
    return blocked({ state: 'forbidden', instructions: 'The selected binding authority is invalid.' });
  }
  const synchronousAuthorization = () => {
    if (!input.bindingId || !context || !authority || !ownerSessionId) return false;
    const currentContext = manager.getBindingContexts().get(input.bindingId);
    const currentAuthority = manager.getBindingAuthority(input.bindingId);
    if (!currentContext || !currentAuthority) return false;
    try {
      if (getProjectPreparationAuthorityIdentity(currentAuthority, currentContext) !== authorityIdentity) return false;
    } catch {
      return false;
    }
    if (
      !validateProjectPreparationAuthority(currentAuthority, {
        bindingId: input.bindingId,
        context: currentContext,
        ownerSessionId,
      })
    )
      return false;
    if (!authentication && AgentConfigManager.getInstance().isAuthEnabled()) return false;
    const current = ConfigManager.getInstance().loadDeclaredServerConfigs();
    if (current.errors.length) return false;
    const currentDefinition = current.templateServers[target.backendName] ?? current.staticServers[target.backendName];
    if (JSON.stringify(currentDefinition) !== JSON.stringify(definition)) return false;
    if (
      currentDefinition?.disabled ||
      getDisabledSourceToolError(
        { ...current.staticServers, ...current.templateServers },
        target.backendName,
        target.toolName,
      )
    )
      return false;
    const grantedTags = authentication?.[3];
    if (Array.isArray(grantedTags) && grantedTags.length) {
      if (!grantedTags.every((tag): tag is string => typeof tag === 'string')) return false;
      if (
        TemplateFilteringService.getMatchingTemplates([[target.backendName, definition]], {
          tags: grantedTags,
          tagFilterMode: 'simple-or',
        }).length !== 1
      )
        return false;
    }
    if (TemplateFilteringService.getMatchingTemplates([[target.backendName, definition]], filterConfig).length !== 1)
      return false;
    if (filterConfig.presetName) {
      const preset = PresetManager.getInstance().getPreset(filterConfig.presetName);
      if (JSON.stringify(preset) !== presetRevision) return false;
      if (preset && JSON.stringify(preset.tagQuery) !== JSON.stringify(filterConfig.tagQuery)) return false;
    }
    return true;
  };
  const authorized = async () => {
    if (!synchronousAuthorization()) return false;
    if (!(await withinRequestBudget(scope, input.signal, async () => revalidateAuth()))) return false;
    if (!synchronousAuthorization()) return false;
    const policies = await withinRequestBudget(scope, input.signal, async () =>
      resolveProjectPolicies(context!, filterConfig),
    );
    if (!(await withinRequestBudget(scope, input.signal, async () => revalidateAuth()))) return false;
    return (
      synchronousAuthorization() &&
      isProjectBackendVisible({ ...definition, projectTarget: { mode: 'single' } }, context, policies)
    );
  };
  if (declared.errors.length || !(await authorized()))
    return blocked({
      state: 'forbidden',
      instructions: 'A current verified local checkout grant and visible backend are required.',
    });
  // No checkout filesystem access precedes the receipt, current auth, configured filter, and disabled-tool checks.
  const checkoutPath = requireProjectTarget(context!, 'single')[0].path;
  const coordinator = ports?.coordinator ?? getBackendPreparationCoordinator(serverManager);
  const runtimeScopeId = new RuntimeIdentityService({
    storageDir: AgentConfigManager.getInstance().get('runtimeScopeStoragePath'),
  }).getRuntimeScopeId();
  const grant = await withinRequestBudget(scope, input.signal, async () =>
    coordinator.resolveGrant({
      backendName: target.backendName,
      checkoutPath,
      owner: createPreparationOwnerIdentity(runtimeScopeId, authentication, filterConfig),
      filterConfig,
    }),
  );
  const args = projectToolArguments(definition, context!, target.arguments);
  if (args && typeof args === 'object' && !Array.isArray(args) && Object.hasOwn(args, 'projectPath')) {
    const projectPath = (args as Record<string, unknown>).projectPath;
    // Compare without reading any caller-selected path. The configured native helper repeats this fence before SDK dispatch.
    if (
      typeof projectPath !== 'string' ||
      !path.isAbsolute(projectPath) ||
      path.normalize(projectPath) !== grant.target.checkoutRoot
    )
      return blocked({ state: 'forbidden', instructions: 'projectPath conflicts with the verified Project Checkout.' });
  }
  const expiresAt =
    scope?.expiresAt ?? Date.now() + (ConfigManager.getInstance().getAppConfig().preparation?.requestWaitMs ?? 5000);
  const remaining = () => Math.max(0, expiresAt - Date.now());
  if (input.signal?.aborted || remaining() === 0)
    return blocked({ state: 'unknown', reason: input.signal?.aborted ? 'caller_disconnected' : 'inspection_timeout' });
  let toolVisibility: string | undefined;
  const configuredEnvironment = definition.env;
  if (
    configuredEnvironment &&
    !Array.isArray(configuredEnvironment) &&
    Object.hasOwn(configuredEnvironment, 'CODEGRAPH_MCP_TOOLS')
  ) {
    const rendered = await withinRequestBudget(scope, input.signal, async () =>
      ConfigManager.getInstance().loadConfigWithTemplates(context),
    );
    if (rendered.errors.length)
      return blocked({ state: 'forbidden', instructions: 'The configured backend environment could not be resolved.' });
    const environment = (rendered.templateServers[target.backendName] ?? rendered.staticServers[target.backendName])
      ?.env;
    if (!environment || Array.isArray(environment) || typeof environment.CODEGRAPH_MCP_TOOLS !== 'string')
      return blocked({
        state: 'forbidden',
        instructions: 'The configured native tool visibility could not be resolved.',
      });
    toolVisibility = environment.CODEGRAPH_MCP_TOOLS;
  }
  const nativeDefinition = await withinRequestBudget(scope, input.signal, async (signal) =>
    (ports?.toolDefinition ?? getCodeGraphPreparationToolDefinition)(
      {
        executable: preparationConfig.executable,
        expectedVersion: preparationConfig.expectedVersion,
        toolName: target.toolName,
        toolVisibility,
      },
      { signal, executionDeadlineMs: remaining() },
    ),
  );
  if (!nativeDefinition)
    return blocked({
      state: 'unsupported',
      instructions: 'The pinned native backend does not expose this source operation.',
    });
  await withinRequestBudget(scope, input.signal, async (signal) => {
    if (ports?.validateArguments) return ports.validateArguments(nativeDefinition, args, signal);
    const validationBinding = {
      routeKey: `${target.backendName}/${target.toolName}`,
      generation: grant.target.configurationKey,
      signal,
    };
    const contracts = await admitToolSchemas(nativeDefinition, validationBinding);
    await prepareToolValidation(contracts, args, validationBinding);
  });
  if (!(await authorized())) return blocked({ state: 'forbidden', instructions: 'Preparation authorization changed.' });
  const result = await coordinator.admit(grant, target.toolName, {
    waitMs: remaining(),
    signal: input.signal,
    validateAdmission: authorized,
    assertAdmission: () => {
      if (!synchronousAuthorization()) throw new PreparationAuthorizationChangedError();
    },
  });
  if (result.state !== 'ready') return blocked(result);
  if (!(await authorized())) return blocked({ state: 'forbidden', instructions: 'Preparation authorization changed.' });
  await withinRequestBudget(scope, input.signal, async () =>
    (ports?.refresh ?? refreshPreparedBackendCapabilities)(serverManager, grant.target, {
      missingTool: target.toolName,
    }),
  );
  if (!(await authorized())) return blocked({ state: 'forbidden', instructions: 'Preparation authorization changed.' });
  const beforeDispatch = async (): Promise<ToolDispatchDecision> => {
    const defer = (preparation: unknown) => ({ result: preparationToolResult(preparation).structuredContent });
    try {
      if (!(await authorized()))
        return defer({ state: 'forbidden', instructions: 'Preparation authorization changed.' });
      const current = await coordinator.admit(grant, target.toolName, {
        waitMs: remaining(),
        signal: input.signal,
        validateAdmission: authorized,
        assertAdmission: () => {
          if (!synchronousAuthorization()) throw new PreparationAuthorizationChangedError();
        },
      });
      if (current.state !== 'ready') return defer(current);
      // No asynchronous policy or catalog work follows this fresh native barrier.
      if (!synchronousAuthorization())
        return defer({ state: 'forbidden', instructions: 'Preparation authorization changed.' });
      if (input.signal?.aborted || remaining() === 0)
        return defer({
          state: 'unknown',
          reason: input.signal?.aborted ? 'caller_disconnected' : 'inspection_timeout',
        });
      return {
        assertCurrent: () => synchronousAuthorization() && !input.signal?.aborted && remaining() > 0,
      };
    } catch (error) {
      if (error instanceof PreparationCallerStopped) return defer({ state: 'unknown', reason: error.reason });
      if (error instanceof PreparationAuthorizationChangedError)
        return defer({ state: 'forbidden', instructions: error.message });
      throw error;
    }
  };
  const setupDeadline = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, remaining()));
    timer.unref();
    return {
      signal: input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal,
      stop: () => clearTimeout(timer),
    };
  };
  return { kind: 'ready', setupDeadline, revalidate: authorized, beforeDispatch };
}
