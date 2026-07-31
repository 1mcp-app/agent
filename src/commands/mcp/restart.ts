import { randomUUID } from 'node:crypto';

import { ApiClient } from '@src/commands/shared/apiClient.js';
import { type ResolvableServeTargetOptions, resolveServeTarget } from '@src/commands/shared/serveTargetResolver.js';
import { RuntimeTargetStore, RuntimeTargetStoreError } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';
import { stripMcpSuffix } from '@src/utils/urlUtils.js';

import type { Argv } from 'yargs';

import { validateServerName } from './utils/validation.js';

const DEFAULT_RESTART_WAIT_MS = 5_000;

export interface RestartCommandArgs extends GlobalOptions {
  name: string;
  context?: string;
  url?: string;
  instance?: string;
  allInstances?: boolean;
  'all-instances'?: boolean;
  json?: boolean;
  idempotencyKey?: string;
  waitMs?: number;
  confirmNonLoopback?: boolean;
  'confirm-non-loopback'?: boolean;
}

interface RuntimeBackedRestartApiClient {
  get<T>(path: string): Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
  post<T>(
    path: string,
    body: unknown,
    options?: { headers?: Record<string, string>; timeout?: number },
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
}

export interface RestartCommandDependencies {
  runtimeTargetStore?: Pick<
    RuntimeTargetStore,
    'current' | 'inspect' | 'getAdminSessionReference' | 'clearAdminSessionReference'
  >;
  resolveTarget?: (options: ResolvableServeTargetOptions & { context: string }) => Promise<{ discoveredUrl: string }>;
  createApiClient?: (
    baseUrl: string,
    bearerToken?: string,
    options?: { timeout?: number },
  ) => RuntimeBackedRestartApiClient;
  createIdempotencyKey?: () => string;
  wait?: (ms: number) => Promise<void>;
}

interface CliAdminEnvelope<T> {
  ok: boolean;
  cliProtocolVersion?: string;
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
  runtime?: { runtimeScopeId?: string };
  supportedOperations?: string[];
  adminMutationsAvailable?: boolean;
  mutationReadiness?: { mcp?: { enabled?: boolean; operations?: string[] } };
}

class RestartCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoveryCommand?: string,
    readonly details?: unknown,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'RestartCommandError';
  }
}

export function buildRestartCommand(yargs: Argv) {
  return yargs
    .positional('name', {
      describe: 'Name of the static server or template backend to restart',
      type: 'string',
      demandOption: true,
    })
    .option('context', {
      describe: 'Runtime Target Context name for the restart operation',
      type: 'string',
    })
    .option('url', {
      describe: 'Ephemeral Runtime URL selector; credentialed admin mutation requires --context',
      type: 'string',
    })
    .option('instance', {
      describe: 'Template instance ID or unambiguous prefix to restart',
      type: 'string',
    })
    .option('all-instances', {
      describe: 'Restart all active instances of a template backend',
      type: 'boolean',
    })
    .conflicts('instance', 'all-instances')
    .option('idempotency-key', {
      describe: 'Stable idempotency key for retrying the restart operation',
      type: 'string',
    })
    .option('wait-ms', {
      describe: 'Maximum time to wait for restart operation completion',
      type: 'number',
      default: DEFAULT_RESTART_WAIT_MS,
    })
    .option('confirm-non-loopback', {
      describe: 'Confirm restart against a non-loopback runtime target',
      type: 'boolean',
      default: false,
    })
    .option('json', {
      describe: 'Write machine-readable JSON output',
      type: 'boolean',
      default: false,
    })
    .example([
      ['$0 mcp restart filesystem', 'Restart one static supervised backend'],
      ['$0 mcp restart github --instance abc123', 'Restart one template instance by ID prefix'],
      ['$0 mcp restart github --all-instances', 'Restart all active instances of a template backend'],
    ]);
}

export async function restartCommand(
  argv: RestartCommandArgs,
  dependencies: RestartCommandDependencies = {},
): Promise<void> {
  try {
    const allInstances = argv.allInstances ?? argv['all-instances'] ?? false;
    if (argv.instance !== undefined && allInstances) {
      throw new RestartCommandError('restart_selector_conflict', 'Use either --instance or --all-instances, not both');
    }
    validateServerName(argv.name);

    const store = dependencies.runtimeTargetStore ?? new RuntimeTargetStore();
    const contextName = selectContext(argv, store);
    const resolver = dependencies.resolveTarget ?? ((options) => resolveServeTarget(options));
    const target = await resolver({ ...argv, context: contextName, url: undefined });
    const baseUrl = stripMcpSuffix(target.discoveredUrl);
    const capabilitiesClient = createClient(dependencies, baseUrl);
    const capabilities = await getEnvelope<CliCapabilitiesResult>(capabilitiesClient, '/admin/cli/v1/capabilities');
    requireRestartCapability(capabilities);
    const runtimeScopeId = capabilities.result?.runtime?.runtimeScopeId;
    if (!runtimeScopeId) {
      throw new RestartCommandError('protocol_invalid_response', 'CLI Admin capabilities omitted runtime identity');
    }

    const sessionReference = store.getAdminSessionReference(contextName, runtimeScopeId) as {
      sessionToken?: string;
    } | null;
    if (!sessionReference?.sessionToken) {
      throw new RestartCommandError(
        'admin_session_required',
        `Admin Session is required for Runtime Target Context "${contextName}"`,
        `1mcp admin login --context ${contextName}`,
      );
    }

    const authenticatedClient = createClient(dependencies, baseUrl, sessionReference.sessionToken);
    const session = await getEnvelope<{ authenticated?: boolean }>(authenticatedClient, '/admin/cli/v1/session/status');
    if (!session.ok || !session.result?.authenticated) {
      store.clearAdminSessionReference(contextName, runtimeScopeId);
      throw envelopeError(
        session,
        `Admin Session is required for Runtime Target Context "${contextName}"`,
        `1mcp admin login --context ${contextName}`,
      );
    }

    const idempotencyKey = argv.idempotencyKey?.trim() || dependencies.createIdempotencyKey?.() || randomUUID();
    const mutationClient = createClient(dependencies, baseUrl, sessionReference.sessionToken, {
      timeout: boundedWaitMs(argv.waitMs),
    });
    const result = await postRestartWithBoundedWait(
      mutationClient,
      {
        targetName: argv.name,
        ...(argv.instance !== undefined ? { instance: argv.instance } : {}),
        ...(allInstances ? { allInstances: true } : {}),
        confirmationFacts:
          (argv.confirmNonLoopback ?? argv['confirm-non-loopback']) ? confirmationFacts(runtimeScopeId) : {},
      },
      idempotencyKey,
      boundedWaitMs(argv.waitMs),
      dependencies.wait ?? defaultWait,
    );
    if (!result.ok) {
      throw envelopeError(result, `Runtime-backed mcp restart failed for '${argv.name}'`);
    }

    if (argv.json) {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          cliProtocolVersion: '1',
          requestId: randomUUID(),
          operation: 'mcp.restart',
          target: { context: contextName, runtimeScopeId, url: baseUrl },
          warnings: result.warnings ?? [],
          result: result.result,
        })}\n`,
      );
    } else {
      printer.success(`Restarted backend '${argv.name}' on '${contextName}'`);
    }
  } catch (error) {
    handleRestartError(argv, error);
  }
}

function selectContext(argv: RestartCommandArgs, store: Pick<RuntimeTargetStore, 'current' | 'inspect'>): string {
  if (argv.url && argv.context) {
    throw new RuntimeTargetStoreError('target_selector_conflict', 'Use either --url or --context, not both');
  }
  if (argv.url) {
    throw new RuntimeTargetStoreError(
      'target_url_credentialed_mutation_unsupported',
      'Ephemeral URL targets cannot perform credentialed admin mutations; add a Runtime Target Context first',
    );
  }
  if (argv.context) {
    return store.inspect(argv.context).name;
  }
  return store.current().name;
}

function requireRestartCapability(envelope: CliAdminEnvelope<CliCapabilitiesResult>): void {
  if (!envelope.ok) {
    throw envelopeError(envelope, 'CLI Admin capabilities check failed');
  }
  if (envelope.cliProtocolVersion !== '1' || !envelope.result) {
    throw new RestartCommandError('protocol_incompatible', 'CLI Admin protocol is not compatible');
  }
  if (!envelope.result.supportedOperations?.includes('mcp.restart')) {
    throw new RestartCommandError(
      'capability_operation_unsupported',
      'CLI Admin operation "mcp.restart" is not supported by this runtime',
    );
  }
  if (
    envelope.result.adminMutationsAvailable === false ||
    envelope.result.mutationReadiness?.mcp?.enabled === false ||
    !envelope.result.mutationReadiness?.mcp?.operations?.includes('restart')
  ) {
    throw new RestartCommandError('capability_mutation_unavailable', 'Runtime-backed MCP restart is unavailable');
  }
}

function createClient(
  dependencies: RestartCommandDependencies,
  baseUrl: string,
  bearerToken?: string,
  options: { timeout?: number } = {},
): RuntimeBackedRestartApiClient {
  return (
    dependencies.createApiClient?.(baseUrl, bearerToken, options) ?? new ApiClient({ baseUrl, bearerToken, ...options })
  );
}

async function getEnvelope<T>(client: RuntimeBackedRestartApiClient, path: string): Promise<CliAdminEnvelope<T>> {
  const response = await client.get<CliAdminEnvelope<T>>(path);
  if (response.data) {
    return response.data;
  }
  return {
    ok: false,
    error: { code: 'request_failed', message: response.error ?? `Request failed with status ${response.status}` },
  };
}

async function postEnvelope<T>(
  client: RuntimeBackedRestartApiClient,
  path: string,
  body: unknown,
  idempotencyKey: string,
  timeout: number,
): Promise<CliAdminEnvelope<T>> {
  const response = await client.post<CliAdminEnvelope<T>>(path, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
    timeout,
  });
  if (response.data) {
    return response.data;
  }
  return {
    ok: false,
    error: { code: 'request_failed', message: response.error ?? `Request failed with status ${response.status}` },
  };
}

async function postRestartWithBoundedWait(
  client: RuntimeBackedRestartApiClient,
  body: unknown,
  idempotencyKey: string,
  waitMs: number,
  wait: (ms: number) => Promise<void>,
): Promise<CliAdminEnvelope<unknown>> {
  const deadline = Date.now() + waitMs;
  while (true) {
    const envelope = await postEnvelope<unknown>(
      client,
      '/admin/cli/v1/operations/restart-server',
      body,
      idempotencyKey,
      Math.max(1, deadline - Date.now()),
    );
    if (envelope.ok || envelope.error?.code !== 'operation_in_progress') {
      return envelope;
    }
    const retryAfterMs = Math.max(1, envelope.error.retryAfterMs ?? 100);
    if (Date.now() + retryAfterMs > deadline) {
      return envelope;
    }
    await wait(retryAfterMs);
  }
}

async function defaultWait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function envelopeError(
  envelope: CliAdminEnvelope<unknown>,
  fallbackMessage: string,
  fallbackRecoveryCommand?: string,
): RestartCommandError {
  return new RestartCommandError(
    envelope.error?.code ?? 'command_failed',
    envelope.error?.message ?? fallbackMessage,
    envelope.error?.recoveryCommand ?? fallbackRecoveryCommand,
    envelope.error?.details,
    envelope.error?.retryable ?? false,
  );
}

function confirmationFacts(runtimeScopeId: string): Record<string, unknown> {
  return {
    confirm_non_loopback_runtime: true,
    confirmedOperation: 'mcp.restart',
    confirmedRuntimeScopeId: runtimeScopeId,
    confirmationSource: 'cli_flag',
  };
}

function boundedWaitMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RESTART_WAIT_MS;
  }
  return Math.max(1, Math.floor(value));
}

function handleRestartError(argv: RestartCommandArgs, error: unknown): void {
  const coded = isCodedError(error) ? error : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (argv.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        cliProtocolVersion: '1',
        requestId: randomUUID(),
        operation: 'mcp.restart',
        target: { context: argv.context ?? 'current' },
        error: {
          code: coded?.code ?? 'command_failed',
          message,
          retryable: coded?.retryable ?? false,
          ...(coded?.recoveryCommand ? { recoveryCommand: coded.recoveryCommand } : {}),
          ...(coded?.details !== undefined ? { details: coded.details } : {}),
        },
      })}\n`,
    );
    process.exitCode = coded?.code === 'restart_selector_conflict' ? 2 : 1;
    return;
  }
  printer.error(`Failed to restart backend: ${message}`);
  const candidateInstanceIds = restartCandidateInstanceIds(coded?.details);
  if (candidateInstanceIds.length > 0) {
    printer.info(`Candidate instance IDs: ${candidateInstanceIds.join(', ')}`);
  }
  process.exitCode = coded?.code === 'restart_selector_conflict' ? 2 : 1;
}

function restartCandidateInstanceIds(details: unknown): string[] {
  if (typeof details !== 'object' || details === null || !('candidateInstanceIds' in details)) {
    return [];
  }
  const candidates = (details as { candidateInstanceIds?: unknown }).candidateInstanceIds;
  return Array.isArray(candidates) ? candidates.filter((value): value is string => typeof value === 'string') : [];
}

function isCodedError(error: unknown): error is {
  code: string;
  recoveryCommand?: string;
  details?: unknown;
  retryable?: boolean;
} {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string';
}
