import { ApiClient } from '@src/commands/shared/apiClient.js';
import {
  type ResolvableServeTargetOptions,
  type ResolvedServeTarget,
  resolveServeTarget,
} from '@src/commands/shared/serveTargetResolver.js';
import { type RuntimeTargetListEntry, RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { stripMcpSuffix } from '@src/utils/urlUtils.js';

interface AdminJsonOption {
  json?: boolean;
}

interface AdminContextOption {
  context?: string;
  url?: string;
}

export interface AdminLoginOptions extends GlobalOptions, AdminJsonOption, AdminContextOption {
  username?: string;
  password?: string;
}

export interface AdminStatusOptions extends GlobalOptions, AdminJsonOption, AdminContextOption {}

export interface AdminLogoutOptions extends GlobalOptions, AdminJsonOption, AdminContextOption {
  forget?: boolean;
}

interface AdminSessionReference {
  sessionToken: string;
  csrfToken?: string;
  expiresAt?: string;
}

interface AdminCredentialStore {
  current(): Pick<RuntimeTargetListEntry, 'name'>;
  inspect(name: string): Pick<RuntimeTargetListEntry, 'name' | 'observedIdentity'>;
  setAdminSessionReference(name: string, runtimeScopeId: string, adminSession: AdminSessionReference): void;
  getAdminSessionReference(name: string, runtimeScopeId: string): unknown | undefined;
  clearAdminSessionReference(name: string, runtimeScopeId: string): void;
}

interface AdminApiClient {
  get<T>(path: string): Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
  post<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
}

export interface AdminCommandDependencies {
  store?: AdminCredentialStore;
  resolveTarget?: (
    options: ResolvableServeTargetOptions & { context: string },
  ) => Promise<ResolvedServeTarget<ResolvableServeTargetOptions & { context: string }>>;
  createApiClient?: (baseUrl: string, bearerToken?: string) => AdminApiClient;
}

interface CliAdminEnvelope<T> {
  ok: boolean;
  cliProtocolVersion?: string;
  requestId?: string;
  warnings?: Array<{ code: string; message: string; details?: unknown }>;
  result?: T;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    recoveryCommand?: string;
    details?: unknown;
  };
}

interface CliCapabilitiesResult {
  runtime?: {
    runtimeScopeId?: string;
    externalUrl?: string;
    runtimeVersion?: string;
  };
  runtimeIdentity?: {
    runtimeScopeId?: string;
    externalUrl?: string;
    runtimeVersion?: string;
  };
  supportedOperations?: string[];
  adminSurface?: {
    enabled?: boolean;
    status?: string;
  };
}

interface CliLoginResult {
  sessionToken?: string;
  csrfToken?: string;
  expiresAt?: string;
  account?: unknown;
}

export class AdminCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoveryCommand?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AdminCommandError';
  }
}

export async function adminLoginCommand(
  options: AdminLoginOptions,
  dependencies: AdminCommandDependencies = {},
): Promise<void> {
  const context = requireCredentialContext(options, dependencies, 'login');
  const target = await resolveAdminTarget(context, options, dependencies);
  const baseUrl = stripMcpSuffix(target.discoveredUrl);
  const client = createClient(dependencies, baseUrl);
  const capabilities = await fetchCapabilities(client, 'admin.login');
  const runtimeScopeId = requireRuntimeScopeId(capabilities);
  const username = requireOption(options.username, 'admin username');
  const password = requireOption(options.password, 'admin password');

  const loginEnvelope = await postEnvelope<CliLoginResult>(client, '/admin/cli/v1/session/login', {
    username,
    password,
  });
  if (!loginEnvelope.ok) {
    throw envelopeError(loginEnvelope, 'admin login failed');
  }
  const sessionToken = loginEnvelope.result?.sessionToken;
  if (!sessionToken) {
    throw new AdminCommandError('protocol_invalid_response', 'CLI Admin login response did not include a session');
  }

  const reference = {
    sessionToken,
    csrfToken: loginEnvelope.result?.csrfToken,
    expiresAt: loginEnvelope.result?.expiresAt,
  };
  try {
    (dependencies.store ?? new RuntimeTargetStore()).setAdminSessionReference(context, runtimeScopeId, reference);
  } catch (error) {
    await revokeCreatedAdminSession(dependencies, baseUrl, sessionToken);
    throw error;
  }

  writeAdminSuccess(options, {
    operation: 'admin.login',
    target: targetJson(context, runtimeScopeId, baseUrl),
    warnings: loginEnvelope.warnings,
    result: {
      authenticated: true,
      account: loginEnvelope.result?.account,
      expiresAt: reference.expiresAt,
    },
    human: `Admin login succeeded for ${context}.\n`,
  });
}

export async function adminStatusCommand(
  options: AdminStatusOptions,
  dependencies: AdminCommandDependencies = {},
): Promise<void> {
  const context = requireCredentialContext(options, dependencies, 'status');
  const store = dependencies.store ?? new RuntimeTargetStore();
  const localRuntimeScopeId = observedRuntimeScopeId(store, context);
  const localReference = localRuntimeScopeId ? store.getAdminSessionReference(context, localRuntimeScopeId) : undefined;

  let target: ResolvedServeTarget<ResolvableServeTargetOptions & { context: string }>;
  let capabilities: CliCapabilitiesResult;
  let baseUrl: string;
  try {
    target = await resolveAdminTarget(context, options, dependencies);
    baseUrl = stripMcpSuffix(target.discoveredUrl);
    capabilities = await fetchCapabilities(createClient(dependencies, baseUrl), 'admin.status');
  } catch (error) {
    if (isDisabledAdminAdapterError(error) && localRuntimeScopeId) {
      store.clearAdminSessionReference(context, localRuntimeScopeId);
      writeAdminSuccess(options, {
        operation: 'admin.status',
        target: targetJson(context, localRuntimeScopeId, undefined),
        warnings: [],
        result: {
          authenticated: false,
          status: 'unauthenticated',
          localReference: { present: false, runtimeScopeId: localRuntimeScopeId },
        },
        human: `Admin status for ${context}: not authenticated.\n`,
      });
      return;
    }
    if (isProtocolOrCapabilityError(error)) {
      throw error;
    }
    writeAdminSuccess(options, {
      operation: 'admin.status',
      target: targetJson(context, localRuntimeScopeId, undefined),
      warnings: [],
      result: {
        authenticated: false,
        status: 'unknown',
        localReference: { present: localReference !== undefined, runtimeScopeId: localRuntimeScopeId },
      },
      human: `Admin status for ${context}: unknown (runtime could not be verified).\n`,
    });
    return;
  }

  const runtimeScopeId = requireRuntimeScopeId(capabilities);
  const rawReference = store.getAdminSessionReference(context, runtimeScopeId);
  const reference = toAdminSessionReference(rawReference);
  if (!reference?.sessionToken) {
    if (rawReference !== undefined) {
      store.clearAdminSessionReference(context, runtimeScopeId);
    }
    writeAdminSuccess(options, {
      operation: 'admin.status',
      target: targetJson(context, runtimeScopeId, baseUrl),
      warnings: [],
      result: {
        authenticated: false,
        status: 'unauthenticated',
        localReference: { present: false, runtimeScopeId },
      },
      human: `Admin status for ${context}: not logged in.\n`,
    });
    return;
  }

  const client = createClient(dependencies, baseUrl, reference.sessionToken);
  let statusEnvelope: CliAdminEnvelope<{ authenticated?: boolean; status?: string; account?: unknown }>;
  try {
    statusEnvelope = await getEnvelope<{ authenticated?: boolean; status?: string; account?: unknown }>(
      client,
      '/admin/cli/v1/session/status',
    );
  } catch {
    writeAdminSuccess(options, {
      operation: 'admin.status',
      target: targetJson(context, runtimeScopeId, baseUrl),
      warnings: [],
      result: {
        authenticated: false,
        status: 'unknown',
        localReference: { present: true, runtimeScopeId },
      },
      human: `Admin status for ${context}: unknown (runtime could not be verified).\n`,
    });
    return;
  }
  if (statusEnvelope.ok && statusEnvelope.result?.authenticated) {
    writeAdminSuccess(options, {
      operation: 'admin.status',
      target: targetJson(context, runtimeScopeId, baseUrl),
      warnings: statusEnvelope.warnings,
      result: {
        authenticated: true,
        status: 'authenticated',
        account: statusEnvelope.result.account,
        localReference: { present: true, runtimeScopeId },
      },
      human: `Admin status for ${context}: authenticated.\n`,
    });
    return;
  }

  if (!statusEnvelope.ok && !shouldClearAdminSessionReference(statusEnvelope.error?.code)) {
    const error = envelopeError(statusEnvelope, 'admin status failed');
    if (isProtocolOrCapabilityError(error)) {
      throw error;
    }
    writeAdminSuccess(options, {
      operation: 'admin.status',
      target: targetJson(context, runtimeScopeId, baseUrl),
      warnings: statusEnvelope.warnings,
      result: {
        authenticated: false,
        status: 'unknown',
        localReference: { present: true, runtimeScopeId },
      },
      human: `Admin status for ${context}: unknown (runtime could not be verified).\n`,
    });
    return;
  }

  store.clearAdminSessionReference(context, runtimeScopeId);
  writeAdminSuccess(options, {
    operation: 'admin.status',
    target: targetJson(context, runtimeScopeId, baseUrl),
    warnings: statusEnvelope.warnings,
    result: {
      authenticated: false,
      status: 'unauthenticated',
      localReference: { present: false, runtimeScopeId },
    },
    human: `Admin status for ${context}: not authenticated.\n`,
  });
}

export async function adminLogoutCommand(
  options: AdminLogoutOptions,
  dependencies: AdminCommandDependencies = {},
): Promise<void> {
  const context = requireCredentialContext(options, dependencies, 'logout');
  const store = dependencies.store ?? new RuntimeTargetStore();
  if (options.forget) {
    const runtimeScopeId = observedRuntimeScopeId(store, context);
    if (!runtimeScopeId) {
      throw new AdminCommandError(
        'protocol_invalid_response',
        'Cannot forget Admin Session without observed runtime identity',
      );
    }
    store.clearAdminSessionReference(context, runtimeScopeId);
    writeAdminSuccess(options, {
      operation: 'admin.logout',
      target: targetJson(context, runtimeScopeId, undefined),
      warnings: [],
      result: {
        revoked: false,
        forgotLocalReference: true,
      },
      human: `Forgot local Admin Session reference for ${context}; server-side revocation was not confirmed.\n`,
    });
    return;
  }

  const localRuntimeScopeId = observedRuntimeScopeId(store, context);
  const target = await resolveAdminTarget(context, options, dependencies);
  const baseUrl = stripMcpSuffix(target.discoveredUrl);
  let capabilities: CliCapabilitiesResult;
  try {
    capabilities = await fetchCapabilities(createClient(dependencies, baseUrl), 'admin.logout');
  } catch (error) {
    if (isDisabledAdminAdapterError(error) && localRuntimeScopeId) {
      store.clearAdminSessionReference(context, localRuntimeScopeId);
      writeAdminSuccess(options, {
        operation: 'admin.logout',
        target: targetJson(context, localRuntimeScopeId, baseUrl),
        warnings: [],
        result: {
          revoked: false,
          forgotLocalReference: true,
        },
        human: `Forgot local Admin Session reference for ${context}; server-side revocation was not confirmed.\n`,
      });
      return;
    }
    throw error;
  }
  const runtimeScopeId = requireRuntimeScopeId(capabilities);
  const reference = toAdminSessionReference(store.getAdminSessionReference(context, runtimeScopeId));

  if (reference?.sessionToken) {
    const client = createClient(dependencies, baseUrl, reference.sessionToken);
    const logoutEnvelope = await postEnvelope(client, '/admin/cli/v1/session/logout', {});
    if (!logoutEnvelope.ok) {
      throw envelopeError(logoutEnvelope, 'admin logout failed');
    }
  }

  store.clearAdminSessionReference(context, runtimeScopeId);
  writeAdminSuccess(options, {
    operation: 'admin.logout',
    target: targetJson(context, runtimeScopeId, baseUrl),
    warnings: [],
    result: {
      revoked: Boolean(reference?.sessionToken),
      forgotLocalReference: true,
    },
    human: `Admin logout completed for ${context}.\n`,
  });
}

function requireCredentialContext(
  options: AdminContextOption & GlobalOptions,
  dependencies: AdminCommandDependencies,
  command: 'login' | 'logout' | 'status',
): string {
  if (options.url) {
    throw new AdminCommandError(
      'credential_url_unsupported',
      'Admin credential commands require a named Runtime Target Context and do not accept --url',
    );
  }
  if (options.context) {
    return options.context;
  }
  const currentName = safeCurrentName(dependencies.store);
  throw new AdminCommandError(
    'credential_context_required',
    'Admin credential commands require --context <name>',
    currentName ? `1mcp admin ${command} --context ${currentName}` : `1mcp admin ${command} --context <name>`,
  );
}

function safeCurrentName(store: AdminCommandDependencies['store']): string | undefined {
  try {
    return (store ?? new RuntimeTargetStore()).current().name;
  } catch {
    return undefined;
  }
}

async function resolveAdminTarget(
  context: string,
  options: GlobalOptions,
  dependencies: AdminCommandDependencies,
): Promise<ResolvedServeTarget<ResolvableServeTargetOptions & { context: string }>> {
  const resolver = dependencies.resolveTarget ?? ((input) => resolveServeTarget(input));
  return resolver({ context, 'config-dir': options['config-dir'] });
}

function createClient(dependencies: AdminCommandDependencies, baseUrl: string, bearerToken?: string): AdminApiClient {
  return dependencies.createApiClient?.(baseUrl, bearerToken) ?? new ApiClient({ baseUrl, bearerToken });
}

async function fetchCapabilities(client: AdminApiClient, requiredOperation: string): Promise<CliCapabilitiesResult> {
  const envelope = await getEnvelope<CliCapabilitiesResult>(client, '/admin/cli/v1/capabilities');
  if (!envelope.ok) {
    throw envelopeError(envelope, 'CLI Admin capabilities check failed');
  }
  if (envelope.cliProtocolVersion !== '1') {
    throw new AdminCommandError('protocol_incompatible', 'CLI Admin protocol is not compatible');
  }
  if (!envelope.result) {
    throw new AdminCommandError('protocol_invalid_response', 'CLI Admin capabilities omitted result');
  }
  requireAdminCapability(envelope.result, requiredOperation);
  return envelope.result;
}

async function getEnvelope<T>(client: AdminApiClient, path: string): Promise<CliAdminEnvelope<T>> {
  const response = await client.get<CliAdminEnvelope<T>>(path);
  if (response.data) {
    return response.data;
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new AdminCommandError('capability_admin_disabled', 'CLI Admin adapter is not enabled on this runtime');
    }
    throw new AdminCommandError('runtime_unreachable', response.error ?? `Runtime returned HTTP ${response.status}`);
  }
  throw new AdminCommandError('protocol_invalid_response', 'Runtime returned an empty CLI Admin response');
}

async function postEnvelope<T>(client: AdminApiClient, path: string, body: unknown): Promise<CliAdminEnvelope<T>> {
  const response = await client.post<CliAdminEnvelope<T>>(path, body);
  if (response.data) {
    return response.data;
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new AdminCommandError('capability_admin_disabled', 'CLI Admin adapter is not enabled on this runtime');
    }
    throw new AdminCommandError('runtime_unreachable', response.error ?? `Runtime returned HTTP ${response.status}`);
  }
  throw new AdminCommandError('protocol_invalid_response', 'Runtime returned an empty CLI Admin response');
}

async function revokeCreatedAdminSession(
  dependencies: AdminCommandDependencies,
  baseUrl: string,
  sessionToken: string,
): Promise<void> {
  try {
    await postEnvelope(createClient(dependencies, baseUrl, sessionToken), '/admin/cli/v1/session/logout', {});
  } catch {
    // The original local persistence failure is more actionable for the operator.
  }
}

function envelopeError(envelope: CliAdminEnvelope<unknown>, fallbackMessage: string): AdminCommandError {
  return new AdminCommandError(
    envelope.error?.code ?? 'internal_error',
    envelope.error?.message ?? fallbackMessage,
    envelope.error?.recoveryCommand,
    envelope.error?.details,
  );
}

function requireRuntimeScopeId(capabilities: CliCapabilitiesResult): string {
  const runtimeScopeId = (capabilities.runtime ?? capabilities.runtimeIdentity)?.runtimeScopeId;
  if (!runtimeScopeId) {
    throw new AdminCommandError('protocol_invalid_response', 'CLI Admin capabilities omitted runtime identity');
  }
  return runtimeScopeId;
}

function requireAdminCapability(capabilities: CliCapabilitiesResult, requiredOperation: string): void {
  if (capabilities.adminSurface?.enabled === false) {
    throw new AdminCommandError('capability_admin_disabled', 'CLI Admin adapter is disabled on this runtime');
  }

  if (requiredOperation === 'admin.login' && capabilities.adminSurface?.status === 'setupRequired') {
    throw new AdminCommandError(
      'capability_admin_setup_required',
      'Admin setup is required before CLI Admin login can run',
    );
  }

  if (!capabilities.supportedOperations?.includes(requiredOperation)) {
    throw new AdminCommandError(
      'capability_operation_unsupported',
      `CLI Admin operation "${requiredOperation}" is not supported by this runtime`,
    );
  }
}

function isDisabledAdminAdapterError(error: unknown): boolean {
  return error instanceof AdminCommandError && error.code === 'capability_admin_disabled';
}

function isProtocolOrCapabilityError(error: unknown): boolean {
  return (
    error instanceof AdminCommandError && (error.code.startsWith('protocol_') || error.code.startsWith('capability_'))
  );
}

function shouldClearAdminSessionReference(code: string | undefined): boolean {
  return (
    code === undefined ||
    code.startsWith('auth_session_') ||
    code === 'auth_admin_disabled' ||
    code === 'auth_account_deleted' ||
    code === 'admin_account_not_found' ||
    code === 'capability_admin_disabled'
  );
}

function requireOption(value: string | undefined, label: string): string {
  if (!value) {
    throw new AdminCommandError('validation_missing_input', `Missing ${label}`);
  }
  return value;
}

function observedRuntimeScopeId(store: AdminCredentialStore, context: string): string | undefined {
  try {
    return store.inspect(context).observedIdentity?.runtimeScopeId;
  } catch {
    return undefined;
  }
}

function toAdminSessionReference(value: unknown): AdminSessionReference | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Partial<AdminSessionReference>;
  if (typeof candidate.sessionToken !== 'string' || candidate.sessionToken.length === 0) {
    return undefined;
  }
  return {
    sessionToken: candidate.sessionToken,
    ...(typeof candidate.csrfToken === 'string' ? { csrfToken: candidate.csrfToken } : {}),
    ...(typeof candidate.expiresAt === 'string' ? { expiresAt: candidate.expiresAt } : {}),
  };
}

function writeAdminSuccess(
  options: AdminJsonOption,
  input: {
    operation: string;
    target: unknown;
    warnings?: Array<{ code: string; message: string; details?: unknown }>;
    result: unknown;
    human: string;
  },
): void {
  if (!options.json) {
    process.stdout.write(input.human);
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      cliProtocolVersion: '1',
      requestId: createCliRequestId(),
      target: input.target,
      operation: input.operation,
      warnings: input.warnings ?? [],
      result: input.result,
    })}\n`,
  );
}

function targetJson(context: string, runtimeScopeId: string | undefined, baseUrl: string | undefined): unknown {
  return {
    context,
    ...(runtimeScopeId ? { runtimeScopeId } : {}),
    ...(baseUrl ? { url: baseUrl } : {}),
  };
}

function createCliRequestId(): string {
  return `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
