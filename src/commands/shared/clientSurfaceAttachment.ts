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
import type { RuntimeIdentityWarning } from '@src/domains/runtime-targets/runtimeIdentityVerification.js';
import type { ContextData } from '@src/types/context.js';
import { resolveCanonicalSessionId, withCanonicalSessionId } from '@src/utils/context/sessionIdentity.js';
import { stripMcpSuffix } from '@src/utils/urlUtils.js';

export type ReusableClientSurface = 'run' | 'inspect' | 'instructions';
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
    kind: 'remote';
  };
  runtimeIdentityWarnings?: RuntimeIdentityWarning[];
}

export interface ClientSurfaceAttachmentPorts<TOptions extends ResolvableServeTargetOptions> {
  resolveTarget: (options: TOptions) => Promise<ResolvedAttachmentTarget<TOptions>>;
  loadAuthProfile: (configDir: string | undefined, normalizedBaseUrl: string) => Promise<AuthProfile | null>;
  readSessionCache: (cachePath: string, serverUrl: string, contextHash: string) => Promise<CliSessionCache | null>;
  writeSessionCache: (cachePath: string, cache: CliSessionCache) => Promise<void>;
  deleteSessionCache: (cachePath: string) => Promise<void>;
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
  ports?: Partial<ClientSurfaceAttachmentPorts<TOptions>>;
  rest: (context: ClientSurfaceAttachmentContext<TOptions>) => Promise<ClientSurfaceRestResponse<TValue>>;
  mcp: (
    context: ClientSurfaceAttachmentContext<TOptions> & { sendInitialize: boolean },
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
  const authProfile = shouldLoadAuthProfile(target, options)
    ? await ports.loadAuthProfile(options['config-dir'], normalizeServerUrl(baseUrl))
    : null;
  const requestSessionId = resolveCanonicalSessionId({ context: baseContext, transportSessionId: freshSessionId });
  const context = withCanonicalSessionId(baseContext, requestSessionId);

  return {
    target,
    options,
    baseUrl,
    serverUrl: target.serverUrl,
    bearerToken: authProfile?.token,
    context,
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
  });
  const baseUrl = stripMcpSuffix(target.discoveredUrl);
  const authProfilePromise = shouldLoadAuthProfile(target, options)
    ? ports.loadAuthProfile(options['config-dir'], normalizeServerUrl(baseUrl))
    : Promise.resolve(null);
  const [authProfile, cachedSession] = await Promise.all([
    authProfilePromise,
    ports.readSessionCache(cachePath, target.serverUrl.toString(), contextHash),
  ]);
  const requestSessionId = resolveCanonicalSessionId({
    context: baseContext,
    transportSessionId: cachedSession?.sessionId,
  });
  const context = withCanonicalSessionId(baseContext, requestSessionId);
  let restSupport = cachedSession?.hasRestEndpoint;

  const attachmentContext: ClientSurfaceAttachmentContext<TOptions> = {
    target,
    options,
    baseUrl,
    serverUrl: target.serverUrl,
    bearerToken: authProfile?.token,
    context,
    contextHash,
    cachePath,
    cachedSession,
    requestSessionId,
    sessionId: requestSessionId,
    restSupport,
  };

  if (cachedSession?.hasRestEndpoint !== false) {
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
        contextHash,
        cachePath,
        target,
        baseUrl,
        bearerToken: authProfile?.token,
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
        contextHash,
        cachePath,
        target,
        baseUrl,
        bearerToken: authProfile?.token,
        cachedSession,
        restSupport,
        observed: restResponse.observed,
      };
    }

    if (restResponse.reason === 'endpoint_missing') {
      restSupport = false;
      await persistSession(ports, cachePath, {
        sessionId: cachedSession?.sessionId ?? requestSessionId,
        serverUrl: target.serverUrl.toString(),
        contextHash,
        restSupport,
      });
    }
  }

  let mcpResponse = await input.mcp({
    ...attachmentContext,
    restSupport,
    sendInitialize: !cachedSession?.sessionId,
  });

  if (mcpResponse.status === 'stale_session') {
    await ports.deleteSessionCache(cachePath);
    mcpResponse = await input.mcp({
      ...attachmentContext,
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
      contextHash,
      cachePath,
      target,
      baseUrl,
      bearerToken: authProfile?.token,
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
    contextHash,
    cachePath,
    target,
    baseUrl,
    bearerToken: authProfile?.token,
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
    readSessionCache: ports?.readSessionCache ?? readCliSessionCache,
    writeSessionCache: ports?.writeSessionCache ?? writeCliSessionCache,
    deleteSessionCache: ports?.deleteSessionCache ?? deleteCliSessionCache,
    now: ports?.now ?? Date.now,
  };
}

function shouldLoadAuthProfile<TOptions extends ResolvableServeTargetOptions>(
  target: ResolvedAttachmentTarget<TOptions>,
  options: TOptions,
): boolean {
  return !options.url && target.runtimeTargetContext?.kind !== 'remote';
}

export function formatClientSurfaceAuthRequiredMessage<TOptions extends ResolvableServeTargetOptions>(
  context: ClientSurfaceAuthRequiredContext<TOptions>,
): string {
  if (context.target.runtimeTargetContext?.kind === 'remote') {
    return `Authentication required for target context "${context.target.runtimeTargetContext.name}". Context-scoped credentials are required; URL-keyed auth profiles are not used for runtime targets.`;
  }

  if (context.options.url) {
    return `Authentication required for ephemeral URL target. Ephemeral URLs are credentialless; run: 1mcp target add <name> ${context.baseUrl} and retry with --context <name> after context-scoped credentials are available.`;
  }

  return `Authentication required. Run: 1mcp auth login --url ${context.baseUrl} --token <your-token>`;
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
