import path from 'node:path';

import { type AuthProfile, loadAuthProfile, normalizeServerUrl } from '@src/commands/shared/authProfileStore.js';
import { buildCliContext, generateStreamableSessionId } from '@src/commands/shared/cliContext.js';
import {
  type CliSessionCache,
  deleteCliSessionCache,
  getCliSessionCachePath,
  getCliSessionContextHash,
  readCliSessionCache,
  writeCliSessionCache,
} from '@src/commands/shared/serveClient.js';
import {
  type ResolvableServeTargetOptions,
  type ResolvedServeTarget,
  resolveServeTarget,
} from '@src/commands/shared/serveTargetResolver.js';
import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import {
  createTemplateContextProof,
  type TemplateContextProof,
  TemplateContextCapabilityStore,
} from '@src/core/context/templateContextTrust.js';
import { isProcessAlive, readPidFile } from '@src/core/server/pidFileManager.js';
import type { RuntimeIdentityWarning } from '@src/domains/runtime-targets/runtimeIdentityVerification.js';
import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { ContextData } from '@src/types/context.js';
import { resolveCanonicalSessionId, withCanonicalSessionId } from '@src/utils/context/sessionIdentity.js';
import { stripMcpSuffix } from '@src/utils/urlUtils.js';

export type ReusableClientSurface = 'run' | 'inspect' | 'instructions' | 'wait';
export type FreshClientSurface = 'stdio-proxy';
export type RestFallbackReason = 'endpoint_missing' | 'transient_failure' | 'mcp_required';

export interface ResolvedAttachmentTarget<
  TOptions extends ResolvableServeTargetOptions = ResolvableServeTargetOptions,
> {
  cwd: string;
  projectRoot: string;
  projectConfig: ProjectConfig | null;
  mergedOptions: TOptions;
  discoveredUrl: string;
  serverUrl: URL;
  serverPid?: number;
  source: 'user' | 'pidfile' | 'portscan';
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

export interface ClientSurfaceAttachmentPorts<TOptions extends ResolvableServeTargetOptions> {
  resolveTarget: (options: TOptions) => Promise<ResolvedAttachmentTarget<TOptions>>;
  loadAuthProfile: (configDir: string | undefined, normalizedBaseUrl: string) => Promise<AuthProfile | null>;
  getOAuthTokenReference: (contextName: string, runtimeScopeId: string) => Promise<unknown | undefined>;
  readSessionCache: (cachePath: string, serverUrl: string, contextHash: string) => Promise<CliSessionCache | null>;
  writeSessionCache: (cachePath: string, cache: CliSessionCache) => Promise<void>;
  deleteSessionCache: (cachePath: string) => Promise<void>;
  createContextProof: (
    target: ResolvedAttachmentTarget<TOptions>,
    context: ContextData,
  ) => Promise<TemplateContextProof | undefined>;
  now: () => number;
}

export interface ClientSurfaceAttachmentContext<
  TOptions extends ResolvableServeTargetOptions = ResolvableServeTargetOptions,
> {
  target: ResolvedAttachmentTarget<TOptions>;
  options: TOptions;
  baseUrl: string;
  serverUrl: URL;
  bearerToken?: string;
  context: ContextData;
  contextProof?: TemplateContextProof;
  contextHash: string;
  cachePath: string;
  cachedSession: CliSessionCache | null;
  requestSessionId: string;
  sessionId: string;
  restSupport?: boolean;
}

export interface ClientSurfaceAuthRequiredContext<
  TOptions extends ResolvableServeTargetOptions = ResolvableServeTargetOptions,
> {
  baseUrl: string;
  options: TOptions;
  target: Pick<ResolvedAttachmentTarget<TOptions>, 'runtimeTargetContext'>;
}

export interface FreshClientSurfaceAttachmentResult<TOptions extends ResolvableServeTargetOptions> {
  target: ResolvedAttachmentTarget<TOptions>;
  options: TOptions;
  baseUrl: string;
  serverUrl: URL;
  bearerToken?: string;
  context: ContextData;
  contextProof?: TemplateContextProof;
  createContextProof: (context: ContextData) => Promise<TemplateContextProof | undefined>;
  contextHash: string;
  requestSessionId: string;
  sessionId: string;
}

export type ClientSurfaceRestResponse<TValue> =
  | {
      status: 'success';
      value: TValue;
      sessionId?: string;
      restSupport?: boolean;
      observed?: unknown;
    }
  | {
      status: 'fallback';
      reason: RestFallbackReason;
      observed?: unknown;
    }
  | {
      status: 'auth_required';
      message: string;
      observed?: unknown;
    }
  | {
      status: 'error';
      message: string;
      observed?: unknown;
    };

export type ClientSurfaceMcpResponse<TValue> =
  | {
      status: 'success';
      value: TValue;
      sessionId?: string;
      observed?: unknown;
    }
  | {
      status: 'stale_session';
      observed?: unknown;
    }
  | {
      status: 'error';
      message: string;
      observed?: unknown;
    };

export type ReusableClientSurfaceAttachmentResult<TOptions extends ResolvableServeTargetOptions, TValue> =
  | {
      status: 'success';
      protocol: 'rest' | 'mcp';
      value: TValue;
      sessionId?: string;
      requestSessionId: string;
      context: ContextData;
      contextProof?: TemplateContextProof;
      contextHash: string;
      cachePath: string;
      target: ResolvedAttachmentTarget<TOptions>;
      baseUrl: string;
      bearerToken?: string;
      cachedSession: CliSessionCache | null;
      restSupport?: boolean;
      observed?: unknown;
    }
  | {
      status: 'auth_required' | 'error';
      message: string;
      requestSessionId: string;
      context: ContextData;
      contextProof?: TemplateContextProof;
      contextHash: string;
      cachePath: string;
      target: ResolvedAttachmentTarget<TOptions>;
      baseUrl: string;
      bearerToken?: string;
      cachedSession: CliSessionCache | null;
      restSupport?: boolean;
      observed?: unknown;
    };

export interface AttachReusableClientSurfaceOptions<TOptions extends ResolvableServeTargetOptions, TValue> {
  clientSurface: ReusableClientSurface;
  version: string;
  options: TOptions;
  alwaysTryRest?: boolean;
  ports?: Partial<ClientSurfaceAttachmentPorts<TOptions>>;
  rest: (context: ClientSurfaceAttachmentContext<TOptions>) => Promise<ClientSurfaceRestResponse<TValue>>;
  mcp: (
    context: Omit<ClientSurfaceAttachmentContext<TOptions>, 'sessionId'> & {
      sessionId?: string;
      sendInitialize: boolean;
    },
  ) => Promise<ClientSurfaceMcpResponse<TValue>>;
}

export interface AttachFreshClientSurfaceOptions<TOptions extends ResolvableServeTargetOptions> {
  clientSurface: FreshClientSurface;
  version: string;
  options: TOptions;
  ports?: Partial<ClientSurfaceAttachmentPorts<TOptions>>;
}

export async function attachFreshClientSurface<TOptions extends ResolvableServeTargetOptions>(
  input: AttachFreshClientSurfaceOptions<TOptions>,
): Promise<FreshClientSurfaceAttachmentResult<TOptions>> {
  const ports = withDefaultPorts(input.ports);
  const target = await ports.resolveTarget(input.options);
  writeRuntimeTargetWarnings(target.runtimeIdentityWarnings);
  const options = target.mergedOptions as TOptions;
  const freshSessionId = generateStreamableSessionId();
  const baseContext = buildCliContext({
    cwd: target.cwd,
    projectConfig: target.projectConfig,
    projectRoot: target.projectRoot,
    transportType: input.clientSurface,
    version: input.version,
    sessionId: freshSessionId,
  });
  const contextHash = getCliSessionContextHash(baseContext);
  const baseUrl = stripMcpSuffix(target.discoveredUrl);
  const bearerToken = await loadBearerToken(ports, target, options, baseUrl);
  const requestSessionId = resolveCanonicalSessionId({ context: baseContext, transportSessionId: freshSessionId });
  const context = withCanonicalSessionId(baseContext, requestSessionId);
  const contextProof = await ports.createContextProof(target, context);

  return {
    target,
    options,
    baseUrl,
    serverUrl: target.serverUrl,
    bearerToken,
    context,
    contextProof,
    createContextProof: (updatedContext) => ports.createContextProof(target, updatedContext),
    contextHash,
    requestSessionId,
    sessionId: requestSessionId,
  };
}

export async function attachReusableClientSurface<TOptions extends ResolvableServeTargetOptions, TValue>(
  input: AttachReusableClientSurfaceOptions<TOptions, TValue>,
): Promise<ReusableClientSurfaceAttachmentResult<TOptions, TValue>> {
  const ports = withDefaultPorts(input.ports);
  const target = await ports.resolveTarget(input.options);
  writeRuntimeTargetWarnings(target.runtimeIdentityWarnings);
  const options = target.mergedOptions as TOptions;
  const baseContext = buildCliContext({
    cwd: target.cwd,
    projectConfig: target.projectConfig,
    projectRoot: target.projectRoot,
    transportType: input.clientSurface,
    version: input.version,
  });
  const contextHash = getCliSessionContextHash(baseContext);
  const cachePath = getCliSessionCachePath({
    cachePathTemplate: options['cli-session-cache-path'],
    serverPid: target.serverPid,
    serverUrl: target.serverUrl.toString(),
    contextHash,
  });
  const baseUrl = stripMcpSuffix(target.discoveredUrl);
  const bearerTokenPromise = loadBearerToken(ports, target, options, baseUrl);
  const [bearerToken, loadedCachedSession] = await Promise.all([
    bearerTokenPromise,
    ports.readSessionCache(cachePath, target.serverUrl.toString(), contextHash),
  ]);
  let cachedSession = loadedCachedSession;
  let requestSessionId = resolveCanonicalSessionId({
    context: baseContext,
    transportSessionId: cachedSession?.sessionId,
  });
  let context = withCanonicalSessionId(baseContext, requestSessionId);
  let contextProof = await ports.createContextProof(target, context);
  let restSupport = cachedSession?.hasRestEndpoint;

  let attachmentContext: ClientSurfaceAttachmentContext<TOptions> = {
    target,
    options,
    baseUrl,
    serverUrl: target.serverUrl,
    bearerToken,
    context,
    contextProof,
    contextHash,
    cachePath,
    cachedSession,
    requestSessionId,
    sessionId: requestSessionId,
    restSupport,
  };

  if (input.alwaysTryRest || cachedSession?.hasRestEndpoint !== false) {
    const restResponse = await input.rest(attachmentContext);

    if (restResponse.status === 'success') {
      restSupport = restResponse.restSupport ?? true;
      const sessionId = restResponse.sessionId ?? requestSessionId;
      await persistSession(ports, cachePath, {
        sessionId,
        serverUrl: target.serverUrl.toString(),
        contextHash,
        restSupport,
      });
      return {
        status: 'success',
        protocol: 'rest',
        value: restResponse.value,
        sessionId,
        requestSessionId,
        context,
        contextProof,
        contextHash,
        cachePath,
        target,
        baseUrl,
        bearerToken,
        cachedSession,
        restSupport,
        observed: restResponse.observed,
      };
    }

    if (restResponse.status === 'auth_required' || restResponse.status === 'error') {
      return {
        status: restResponse.status,
        message: restResponse.message,
        requestSessionId,
        context,
        contextProof,
        contextHash,
        cachePath,
        target,
        baseUrl,
        bearerToken,
        cachedSession,
        restSupport,
        observed: restResponse.observed,
      };
    }

    if (restResponse.reason === 'endpoint_missing') {
      restSupport = false;
    }
  }

  let mcpResponse = await input.mcp({
    ...attachmentContext,
    sessionId: cachedSession?.sessionId ?? requestSessionId,
    restSupport,
    sendInitialize: !cachedSession?.sessionId,
  });

  if (mcpResponse.status === 'stale_session') {
    await ports.deleteSessionCache(cachePath);
    cachedSession = null;
    requestSessionId = generateStreamableSessionId();
    context = withCanonicalSessionId(baseContext, requestSessionId);
    contextProof = await ports.createContextProof(target, context);
    attachmentContext = {
      ...attachmentContext,
      context,
      contextProof,
      cachedSession,
      requestSessionId,
      sessionId: requestSessionId,
    };
    mcpResponse = await input.mcp({
      ...attachmentContext,
      sessionId: requestSessionId,
      restSupport,
      sendInitialize: true,
    });
  }

  if (mcpResponse.status === 'success') {
    const sessionId = mcpResponse.sessionId ?? requestSessionId;
    await persistSession(ports, cachePath, {
      sessionId,
      serverUrl: target.serverUrl.toString(),
      contextHash,
      restSupport,
    });
    return {
      status: 'success',
      protocol: 'mcp',
      value: mcpResponse.value,
      sessionId,
      requestSessionId,
      context,
      contextProof,
      contextHash,
      cachePath,
      target,
      baseUrl,
      bearerToken,
      cachedSession,
      restSupport,
      observed: mcpResponse.observed,
    };
  }

  return {
    status: 'error',
    message: mcpResponse.status === 'error' ? mcpResponse.message : 'Cached session expired.',
    requestSessionId,
    context,
    contextProof,
    contextHash,
    cachePath,
    target,
    baseUrl,
    bearerToken,
    cachedSession,
    restSupport,
    observed: mcpResponse.observed,
  };
}

function withDefaultPorts<TOptions extends ResolvableServeTargetOptions>(
  ports: Partial<ClientSurfaceAttachmentPorts<TOptions>> | undefined,
): ClientSurfaceAttachmentPorts<TOptions> {
  return {
    resolveTarget:
      ports?.resolveTarget ?? ((options) => resolveServeTarget(options) as Promise<ResolvedServeTarget<TOptions>>),
    loadAuthProfile: ports?.loadAuthProfile ?? loadAuthProfile,
    getOAuthTokenReference:
      ports?.getOAuthTokenReference ??
      ((contextName, runtimeScopeId) =>
        Promise.resolve(new RuntimeTargetStore().getOAuthTokenReference(contextName, runtimeScopeId))),
    readSessionCache: ports?.readSessionCache ?? readCliSessionCache,
    writeSessionCache: ports?.writeSessionCache ?? writeCliSessionCache,
    deleteSessionCache: ports?.deleteSessionCache ?? deleteCliSessionCache,
    createContextProof: ports?.createContextProof ?? createLocalTemplateContextProof,
    now: ports?.now ?? Date.now,
  };
}

async function createLocalTemplateContextProof<TOptions extends ResolvableServeTargetOptions>(
  target: ResolvedAttachmentTarget<TOptions>,
  context: ContextData,
): Promise<TemplateContextProof | undefined> {
  const localScope = target.localRuntimeScope;
  if (!localScope) {
    return undefined;
  }

  if (!isProtectedTemplateContextProofTransport(target.serverUrl)) {
    return undefined;
  }

  const runtimeInfo = readPidFile(localScope.storagePath);
  if (
    !runtimeInfo ||
    !isProcessAlive(runtimeInfo.pid) ||
    path.resolve(runtimeInfo.configDir) !== path.resolve(localScope.storagePath) ||
    (target.serverPid !== undefined && runtimeInfo.pid !== target.serverPid) ||
    normalizeServerUrl(runtimeInfo.url) !== normalizeServerUrl(target.discoveredUrl)
  ) {
    return undefined;
  }

  const capability = new TemplateContextCapabilityStore({
    storageDir: localScope.storagePath,
    runtimeScopeId: localScope.runtimeScopeId,
  }).read();

  return capability ? createTemplateContextProof(context, capability) : undefined;
}

function isProtectedTemplateContextProofTransport(url: URL): boolean {
  if (url.protocol === 'https:') {
    return true;
  }
  if (url.protocol !== 'http:') {
    return false;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

async function loadBearerToken<TOptions extends ResolvableServeTargetOptions>(
  ports: ClientSurfaceAttachmentPorts<TOptions>,
  target: ResolvedAttachmentTarget<TOptions>,
  options: TOptions,
  baseUrl: string,
): Promise<string | undefined> {
  if (options.url) {
    return undefined;
  }

  const runtimeTargetContext = target.runtimeTargetContext;
  if (runtimeTargetContext) {
    if (!runtimeTargetContext.runtimeScopeId) {
      return undefined;
    }
    const reference = await ports.getOAuthTokenReference(
      runtimeTargetContext.name,
      runtimeTargetContext.runtimeScopeId,
    );
    return toOAuthTokenReference(reference)?.token;
  }

  const authProfile = await ports.loadAuthProfile(options['config-dir'], normalizeServerUrl(baseUrl));
  return authProfile?.token;
}

export function formatClientSurfaceAuthRequiredMessage<TOptions extends ResolvableServeTargetOptions>(
  context: ClientSurfaceAuthRequiredContext<TOptions>,
): string {
  const recoveryCommand = getClientSurfaceAuthRecoveryCommand(context);
  if (context.target.runtimeTargetContext) {
    return `Authentication required for target context "${context.target.runtimeTargetContext.name}". Run: ${recoveryCommand}`;
  }

  if (context.options.url) {
    return `Authentication required for ephemeral URL target. Ephemeral URLs are credentialless; run: ${recoveryCommand} and retry with --context <name> after context-scoped credentials are available.`;
  }

  return `Authentication required. Run: ${recoveryCommand}`;
}

export function getClientSurfaceAuthRecoveryCommand<TOptions extends ResolvableServeTargetOptions>(
  context: ClientSurfaceAuthRequiredContext<TOptions>,
): string {
  if (context.target.runtimeTargetContext) {
    return `1mcp auth login --context ${context.target.runtimeTargetContext.name} --token <your-token>`;
  }
  if (context.options.url) {
    return `1mcp target add <name> ${context.baseUrl}`;
  }
  return '1mcp auth login --context local --token <your-token>';
}

function toOAuthTokenReference(value: unknown): { token: string } | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as { token?: unknown };
  return typeof candidate.token === 'string' && candidate.token.length > 0 ? { token: candidate.token } : undefined;
}

function writeRuntimeTargetWarnings(warnings: RuntimeIdentityWarning[] | undefined): void {
  for (const warning of warnings ?? []) {
    process.stderr.write(`${warning.code}: ${warning.message}\n`);
  }
}

async function persistSession<TOptions extends ResolvableServeTargetOptions>(
  ports: ClientSurfaceAttachmentPorts<TOptions>,
  cachePath: string,
  options: {
    sessionId: string;
    serverUrl: string;
    contextHash: string;
    restSupport?: boolean;
  },
): Promise<void> {
  await ports.writeSessionCache(cachePath, {
    sessionId: options.sessionId,
    serverUrl: options.serverUrl,
    contextHash: options.contextHash,
    savedAt: ports.now(),
    hasRestEndpoint: options.restSupport,
  });
}
