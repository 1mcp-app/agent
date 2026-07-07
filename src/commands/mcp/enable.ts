import { randomUUID } from 'node:crypto';

import { ApiClient } from '@src/commands/shared/apiClient.js';
import {
  type ResolvableServeTargetOptions,
  type ResolvedServeTarget,
  resolveServeTarget,
} from '@src/commands/shared/serveTargetResolver.js';
import { MCPServerParams } from '@src/core/types/index.js';
import { RuntimeTargetStore, RuntimeTargetStoreError } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';
import { stripMcpSuffix } from '@src/utils/urlUtils.js';

import type { Argv } from 'yargs';

import {
  backupConfig,
  getServer,
  initializeConfigContext,
  serverExists,
  setServer,
  validateConfigPath,
} from './utils/mcpServerConfig.js';
import { validateServerName } from './utils/validation.js';

const DEFAULT_REMOTE_MUTATION_WAIT_MS = 5_000;

export interface EnableDisableCommandArgs extends GlobalOptions {
  name: string;
  context?: string;
  url?: string;
  json?: boolean;
  idempotencyKey?: string;
  waitMs?: number;
}

interface AdminSessionReference {
  sessionToken: string;
}

interface RuntimeBackedMcpDependencies {
  runtimeTargetStore?: Pick<
    RuntimeTargetStore,
    'current' | 'inspect' | 'getAdminSessionReference' | 'clearAdminSessionReference'
  >;
  resolveTarget?: (
    options: ResolvableServeTargetOptions & { context: string },
  ) => Promise<ResolvedServeTarget<ResolvableServeTargetOptions & { context: string }>>;
  createApiClient?: (
    baseUrl: string,
    bearerToken?: string,
    options?: { timeout?: number },
  ) => RuntimeBackedMcpApiClient;
  createIdempotencyKey?: () => string;
  wait?: (ms: number) => Promise<void>;
}

interface RuntimeBackedMcpApiClient {
  get<T>(path: string): Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
  post<T>(
    path: string,
    body: unknown,
    options?: { headers?: Record<string, string>; timeout?: number },
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
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
    retryAfterMs?: number;
    recoveryCommand?: string;
    details?: unknown;
  };
}

interface CliCapabilitiesResult {
  runtime?: {
    runtimeScopeId?: string;
    runtimeVersion?: string;
  };
  supportedOperations?: string[];
  mutationReadiness?: {
    mcp?: {
      enabled?: boolean;
      status?: string;
      operations?: string[];
    };
  };
  features?: {
    mcpEnableDisable?: boolean;
  };
}

interface LocalMutationResult {
  targetName: string;
  enabled: boolean;
  outcome: 'enabled' | 'disabled' | 'already_enabled' | 'already_disabled';
  backupPath?: string;
}

class McpRuntimeCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoveryCommand?: string,
    public readonly details?: unknown,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'McpRuntimeCommandError';
  }
}

/**
 * Build the enable command configuration
 */
export function buildEnableCommand(yargs: Argv) {
  return buildEnableDisableCommand(yargs, 'enable');
}

/**
 * Build the disable command configuration
 */
export function buildDisableCommand(yargs: Argv) {
  return buildEnableDisableCommand(yargs, 'disable');
}

/**
 * Enable a disabled MCP server
 */
export async function enableCommand(
  argv: EnableDisableCommandArgs,
  dependencies: RuntimeBackedMcpDependencies = {},
): Promise<void> {
  await runEnableDisableCommand(argv, true, dependencies);
}

/**
 * Disable an MCP server without removing it
 */
export async function disableCommand(
  argv: EnableDisableCommandArgs,
  dependencies: RuntimeBackedMcpDependencies = {},
): Promise<void> {
  await runEnableDisableCommand(argv, false, dependencies);
}

function buildEnableDisableCommand(yargs: Argv, operation: 'enable' | 'disable') {
  const enabled = operation === 'enable';
  return yargs
    .positional('name', {
      describe: `Name of the MCP server to ${operation}`,
      type: 'string',
      demandOption: true,
    })
    .option('context', {
      describe: 'Runtime Target Context name for runtime-backed admin mutation',
      type: 'string',
    })
    .option('url', {
      describe: 'Ephemeral Runtime URL selector; credentialed admin mutation requires --context',
      type: 'string',
    })
    .option('idempotency-key', {
      describe: 'Stable idempotency key for retrying runtime-backed admin mutation',
      type: 'string',
    })
    .option('wait-ms', {
      describe: 'Maximum time to wait for runtime-backed mutation completion',
      type: 'number',
      default: DEFAULT_REMOTE_MUTATION_WAIT_MS,
    })
    .option('json', {
      describe: 'Write machine-readable JSON output',
      type: 'boolean',
      default: false,
    })
    .example([[`$0 mcp ${operation} myserver`, enabled ? 'Enable a disabled server' : 'Disable a server temporarily']]);
}

async function runEnableDisableCommand(
  argv: EnableDisableCommandArgs,
  enabled: boolean,
  dependencies: RuntimeBackedMcpDependencies,
): Promise<void> {
  try {
    const store = dependencies.runtimeTargetStore ?? new RuntimeTargetStore();
    const contextName = selectRuntimeBackedContext(argv, store);
    if (contextName) {
      await setRuntimeBackedServerEnabledState(argv, enabled, contextName, store, dependencies);
      return;
    }

    const result = await setLocalServerEnabledState(argv, enabled, { silent: argv.json === true });
    if (argv.json) {
      writeJsonSuccess(argv, {
        operation: operationId(enabled),
        target: { context: 'local' },
        result,
      });
    }
  } catch (error) {
    handleEnableDisableError(argv, enabled, error);
  }
}

function selectRuntimeBackedContext(
  argv: EnableDisableCommandArgs,
  store: Pick<RuntimeTargetStore, 'current' | 'inspect'>,
): string | null {
  if (argv.url && argv.context) {
    throw new RuntimeTargetStoreError(
      'target_selector_conflict',
      'Use either --url or --context, not both, when selecting a runtime target',
    );
  }

  if (argv.url) {
    throw new RuntimeTargetStoreError(
      'target_url_credentialed_mutation_unsupported',
      'Ephemeral URL targets cannot perform credentialed admin mutations; add a Runtime Target Context first',
      { url: argv.url },
    );
  }

  if (argv.context) {
    if (argv.context === 'local') {
      return null;
    }
    const target = store.inspect(argv.context);
    return target.name === 'local' ? null : target.name;
  }

  const current = store.current();
  return current.name === 'local' ? null : current.name;
}

async function setRuntimeBackedServerEnabledState(
  argv: EnableDisableCommandArgs,
  enabled: boolean,
  contextName: string,
  store: Pick<RuntimeTargetStore, 'getAdminSessionReference' | 'clearAdminSessionReference'>,
  dependencies: RuntimeBackedMcpDependencies,
): Promise<void> {
  validateServerName(argv.name);
  const resolver = dependencies.resolveTarget ?? ((input) => resolveServeTarget(input));
  const target = await resolver({ ...argv, context: contextName, url: undefined });
  const baseUrl = stripMcpSuffix(target.discoveredUrl);
  const capabilities = await fetchCapabilities(
    createClient(dependencies, baseUrl),
    enabled ? 'mcp.enable' : 'mcp.disable',
  );
  const runtimeScopeId = requireRuntimeScopeId(capabilities);
  const reference = toAdminSessionReference(store.getAdminSessionReference(contextName, runtimeScopeId));
  if (!reference) {
    throw new McpRuntimeCommandError(
      'auth_admin_session_required',
      `Admin Session is required for Runtime Target Context "${contextName}"`,
      `1mcp admin login --context ${contextName}`,
    );
  }

  const authenticatedClient = createClient(dependencies, baseUrl, reference.sessionToken);
  await validateAdminSession(authenticatedClient, store, contextName, runtimeScopeId);

  const idempotencyKey = argv.idempotencyKey?.trim() || dependencies.createIdempotencyKey?.() || randomUUID();
  const mutationClient = createClient(dependencies, baseUrl, reference.sessionToken, {
    timeout: mutationRequestTimeoutMs(argv.waitMs),
  });
  const mutationEnvelope = await postMutationWithBoundedWait({
    argv,
    enabled,
    client: mutationClient,
    idempotencyKey,
    wait: dependencies.wait ?? defaultWait,
  });
  if (!mutationEnvelope.ok) {
    throw envelopeError(
      mutationEnvelope,
      `Runtime-backed mcp ${enabled ? 'enable' : 'disable'} failed`,
      recoveryCommand(argv, enabled, contextName, idempotencyKey),
    );
  }

  writeJsonSuccess(argv, {
    operation: operationId(enabled),
    target: { context: contextName, runtimeScopeId, url: baseUrl },
    warnings: mutationEnvelope.warnings,
    result: mutationEnvelope.result,
  });

  if (!argv.json) {
    printer.success(`Successfully ${enabled ? 'enabled' : 'disabled'} server '${argv.name}' on '${contextName}'`);
  }
}

async function postMutationWithBoundedWait(input: {
  argv: EnableDisableCommandArgs;
  enabled: boolean;
  client: RuntimeBackedMcpApiClient;
  idempotencyKey: string;
  wait: (ms: number) => Promise<void>;
}): Promise<CliAdminEnvelope<unknown>> {
  const waitMs = boundedMutationWaitMs(input.argv.waitMs);
  const deadline = Date.now() + waitMs;
  const path = `/admin/cli/v1/operations/${input.enabled ? 'enable-server' : 'disable-server'}`;

  while (true) {
    const requestTimeoutMs = Math.max(1, deadline - Date.now());
    const envelope = await postEnvelope(
      input.client,
      path,
      { targetName: input.argv.name },
      { 'Idempotency-Key': input.idempotencyKey },
      requestTimeoutMs,
    );
    if (envelope.ok || envelope.error?.code !== 'operation_in_progress') {
      return envelope;
    }

    const retryAfterMs = Math.max(1, envelope.error.retryAfterMs ?? 100);
    if (Date.now() + retryAfterMs > deadline) {
      return envelope;
    }
    await input.wait(retryAfterMs);
  }
}

async function setLocalServerEnabledState(
  argv: EnableDisableCommandArgs,
  enabled: boolean,
  options: { silent?: boolean } = {},
): Promise<LocalMutationResult> {
  const { name, config: configPath, 'config-dir': configDir } = argv;

  initializeConfigContext(configPath, configDir);
  if (!options.silent) {
    printer.info(`${enabled ? 'Enabling' : 'Disabling'} MCP server: ${name}`);
  }

  validateServerName(name);
  validateConfigPath();

  if (!serverExists(name)) {
    throw new Error(`Server '${name}' does not exist. Use 'mcp add' to create it first.`);
  }

  const currentConfig = getServer(name);
  if (!currentConfig) {
    throw new Error(`Failed to retrieve server '${name}' configuration.`);
  }

  if (Boolean(currentConfig.disabled) === !enabled) {
    if (!options.silent) {
      printer.info(`Server '${name}' is already ${enabled ? 'enabled' : 'disabled'}.`);
    }
    return {
      targetName: name,
      enabled,
      outcome: enabled ? 'already_enabled' : 'already_disabled',
    };
  }

  const backupPath = backupConfig();
  const updatedConfig: MCPServerParams = {
    ...currentConfig,
    disabled: !enabled,
  };

  if (enabled) {
    delete updatedConfig.disabled;
  }

  setServer(name, updatedConfig);

  if (!options.silent) {
    printer.success(`Successfully ${enabled ? 'enabled' : 'disabled'} server '${name}'`);
    printer.keyValue({ Status: enabled ? 'Disabled → Enabled' : 'Enabled → Disabled', 'Backup created': backupPath });
    printer.blank();
    printer.info(
      enabled
        ? 'Server enabled. If 1mcp is running, the server will be started automatically.'
        : 'Server disabled. If 1mcp is running, the server will be stopped automatically.',
    );
    if (!enabled) {
      printer.info(`Use 'mcp enable ${name}' to re-enable it later.`);
    }
  }

  return {
    targetName: name,
    enabled,
    outcome: enabled ? 'enabled' : 'disabled',
    backupPath,
  };
}

async function fetchCapabilities(
  client: RuntimeBackedMcpApiClient,
  requiredOperation: string,
): Promise<CliCapabilitiesResult> {
  const envelope = await getEnvelope<CliCapabilitiesResult>(client, '/admin/cli/v1/capabilities');
  if (!envelope.ok) {
    throw envelopeError(envelope, 'CLI Admin capabilities check failed');
  }
  if (envelope.cliProtocolVersion !== '1') {
    throw new McpRuntimeCommandError('protocol_incompatible', 'CLI Admin protocol is not compatible');
  }
  if (!envelope.result) {
    throw new McpRuntimeCommandError('protocol_invalid_response', 'CLI Admin capabilities omitted result');
  }
  if (!envelope.result.supportedOperations?.includes(requiredOperation)) {
    throw new McpRuntimeCommandError(
      'capability_operation_unsupported',
      `CLI Admin operation "${requiredOperation}" is not supported by this runtime`,
    );
  }
  requireMutationReadiness(envelope.result, requiredOperation);
  return envelope.result;
}

async function validateAdminSession(
  client: RuntimeBackedMcpApiClient,
  store: Pick<RuntimeTargetStore, 'clearAdminSessionReference'>,
  contextName: string,
  runtimeScopeId: string,
): Promise<void> {
  const envelope = await getEnvelope<{ authenticated?: boolean }>(client, '/admin/cli/v1/session/status');
  if (envelope.ok && envelope.result?.authenticated) {
    return;
  }

  if (shouldClearAdminSessionReference(envelope.error?.code)) {
    store.clearAdminSessionReference(contextName, runtimeScopeId);
  }
  throw new McpRuntimeCommandError(
    envelope.error?.code ?? 'auth_admin_session_required',
    envelope.error?.message ?? `Admin Session is required for Runtime Target Context "${contextName}"`,
    `1mcp admin login --context ${contextName}`,
    envelope.error?.details,
    envelope.error?.retryable ?? false,
    envelope.error?.retryAfterMs,
  );
}

function requireMutationReadiness(capabilities: CliCapabilitiesResult, requiredOperation: string): void {
  const requiredMcpOperation = requiredOperation === 'mcp.enable' ? 'enable' : 'disable';
  if (
    capabilities.features?.mcpEnableDisable === false ||
    capabilities.mutationReadiness?.mcp?.enabled === false ||
    !capabilities.mutationReadiness?.mcp?.operations?.includes(requiredMcpOperation)
  ) {
    throw new McpRuntimeCommandError(
      'capability_mutation_unavailable',
      `MCP mutation operation "${requiredOperation}" is unavailable on this runtime`,
      undefined,
      {
        status: capabilities.mutationReadiness?.mcp?.status,
      },
    );
  }
}

async function getEnvelope<T>(client: RuntimeBackedMcpApiClient, path: string): Promise<CliAdminEnvelope<T>> {
  const response = await client.get<CliAdminEnvelope<T>>(path);
  if (response.data) {
    return response.data;
  }
  throw new McpRuntimeCommandError('runtime_unreachable', response.error ?? `Runtime returned HTTP ${response.status}`);
}

async function postEnvelope<T>(
  client: RuntimeBackedMcpApiClient,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  timeout: number,
): Promise<CliAdminEnvelope<T>> {
  const response = await client.post<CliAdminEnvelope<T>>(path, body, { headers, timeout });
  if (response.data) {
    return response.data;
  }
  if (isRequestTimeout(response)) {
    return {
      ok: false,
      cliProtocolVersion: '1',
      warnings: [],
      error: {
        code: 'operation_in_progress',
        message: 'Admin operation did not finish before the CLI wait window',
        retryable: true,
        retryAfterMs: timeout,
      },
    };
  }
  throw new McpRuntimeCommandError('runtime_unreachable', response.error ?? `Runtime returned HTTP ${response.status}`);
}

function boundedMutationWaitMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_REMOTE_MUTATION_WAIT_MS;
  }
  return Math.max(0, value);
}

function mutationRequestTimeoutMs(value: number | undefined): number {
  return Math.max(1, boundedMutationWaitMs(value));
}

function isRequestTimeout(response: { status: number; error?: string }): boolean {
  return response.status === 0 && /timed out/i.test(response.error ?? '');
}

function envelopeError(
  envelope: CliAdminEnvelope<unknown>,
  fallbackMessage: string,
  fallbackRecoveryCommand?: string,
): McpRuntimeCommandError {
  return new McpRuntimeCommandError(
    envelope.error?.code ?? 'internal_error',
    envelope.error?.message ?? fallbackMessage,
    envelope.error?.recoveryCommand ?? fallbackRecoveryCommand,
    {
      ...(envelope.error?.details && typeof envelope.error.details === 'object' ? envelope.error.details : {}),
      ...(envelope.error?.retryAfterMs !== undefined ? { retryAfterMs: envelope.error.retryAfterMs } : {}),
    },
    envelope.error?.retryable ?? false,
    envelope.error?.retryAfterMs,
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

function requireRuntimeScopeId(capabilities: CliCapabilitiesResult): string {
  const runtimeScopeId = capabilities.runtime?.runtimeScopeId;
  if (!runtimeScopeId) {
    throw new McpRuntimeCommandError('protocol_invalid_response', 'CLI Admin capabilities omitted runtime identity');
  }
  return runtimeScopeId;
}

function toAdminSessionReference(value: unknown): AdminSessionReference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<AdminSessionReference>;
  return typeof candidate.sessionToken === 'string' && candidate.sessionToken.length > 0
    ? { sessionToken: candidate.sessionToken }
    : null;
}

function createClient(
  dependencies: RuntimeBackedMcpDependencies,
  baseUrl: string,
  bearerToken?: string,
  options: { timeout?: number } = {},
): RuntimeBackedMcpApiClient {
  return (
    dependencies.createApiClient?.(baseUrl, bearerToken, options) ?? new ApiClient({ baseUrl, bearerToken, ...options })
  );
}

function writeJsonSuccess(
  argv: EnableDisableCommandArgs,
  input: {
    operation: string;
    target: unknown;
    result: unknown;
    warnings?: Array<{ code: string; message: string; details?: unknown }>;
  },
): void {
  if (!argv.json) {
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      cliProtocolVersion: '1',
      requestId: createCliRequestId(),
      operation: input.operation,
      target: input.target,
      warnings: input.warnings ?? [],
      result: input.result,
    })}\n`,
  );
}

function handleEnableDisableError(argv: EnableDisableCommandArgs, enabled: boolean, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (argv.json) {
    const coded = isCodedError(error) ? error : undefined;
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        cliProtocolVersion: '1',
        requestId: createCliRequestId(),
        operation: operationId(enabled),
        error: {
          code: coded?.code ?? 'command_failed',
          message,
          retryable: coded?.retryable ?? false,
          ...(coded?.recoveryCommand ? { recoveryCommand: coded.recoveryCommand } : {}),
          ...(coded?.retryAfterMs !== undefined ? { retryAfterMs: coded.retryAfterMs } : {}),
          ...(coded?.details !== undefined ? { details: coded.details } : {}),
        },
      })}\n`,
    );
    process.exitCode = exitCodeForError(error);
    return;
  }

  printer.error(`Failed to ${enabled ? 'enable' : 'disable'} server: ${message}`);
  process.exit(1);
}

function isCodedError(error: unknown): error is {
  code: string;
  message: string;
  recoveryCommand?: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
} {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string';
}

function exitCodeForError(error: unknown): number {
  if (!isCodedError(error)) {
    return 1;
  }
  if (error.code.startsWith('auth_') || error.code.includes('session')) {
    return 3;
  }
  if (
    error.code.startsWith('target_') ||
    error.code.startsWith('identity_') ||
    error.code.startsWith('protocol_') ||
    error.code.startsWith('capability_')
  ) {
    return 4;
  }
  if (error.code.startsWith('credential_') || error.code.startsWith('validation_')) {
    return 2;
  }
  return 1;
}

function recoveryCommand(
  argv: EnableDisableCommandArgs,
  enabled: boolean,
  contextName: string,
  idempotencyKey: string,
): string {
  return `1mcp mcp ${enabled ? 'enable' : 'disable'} ${argv.name} --context ${contextName} --idempotency-key ${idempotencyKey}${argv.json ? ' --json' : ''}`;
}

function operationId(enabled: boolean): string {
  return enabled ? 'mcp.enable' : 'mcp.disable';
}

function createCliRequestId(): string {
  return `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function defaultWait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
