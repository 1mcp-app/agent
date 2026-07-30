import { encode } from '@toon-format/toon';

import { ApiClient } from '@src/commands/shared/apiClient.js';
import {
  attachReusableClientSurface,
  type ClientSurfaceAttachmentContext,
  formatClientSurfaceAuthRequiredMessage,
  getClientSurfaceAuthRecoveryCommand,
} from '@src/commands/shared/clientSurfaceAttachment.js';
import { buildFilterSelectionQuery } from '@src/commands/shared/filterSelectionQuery.js';
import { inspectServersResultSchema, type InspectServerSummary } from '@src/commands/shared/inspectApiSchemas.js';
import { API_INSPECT_ENDPOINT } from '@src/constants/api.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { z } from 'zod';

export interface WaitCommandOptions extends GlobalOptions {
  server?: string;
  url?: string;
  context?: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
  timeout?: number;
  format?: 'toon' | 'text' | 'json';
}

const waitCommandOptionsSchema = z
  .object({
    server: z.string().optional(),
    url: z.string().optional(),
    context: z.string().optional(),
    preset: z.string().optional(),
    filter: z.string().optional(),
    tags: z.array(z.string()).optional(),
    'tag-filter': z.string().optional(),
    timeout: z.number().finite().optional(),
    format: z.enum(['toon', 'text', 'json']).optional(),
    config: z.string().optional(),
    'config-dir': z.string().optional(),
    'cli-session-cache-path': z.string().optional(),
    'log-level': z.enum(['debug', 'info', 'warn', 'error']).optional(),
    'log-file': z.string().optional(),
  })
  .passthrough();

interface WaitResult {
  kind: 'wait';
  servers: InspectServerSummary[];
  waitedMs: number;
}

export class WaitCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoveryCommand: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WaitCommandError';
  }
}

export async function waitCommand(options: WaitCommandOptions): Promise<void> {
  const parsedOptions = waitCommandOptionsSchema.safeParse(options);
  if (!parsedOptions.success) {
    if (parsedOptions.error.issues.some((issue) => issue.path[0] === 'timeout')) {
      throwInvalidTimeout();
    }
    throw new WaitCommandError(
      'validation_options',
      `Invalid wait options: ${parsedOptions.error.issues[0]?.message ?? 'validation failed'}`,
      '1mcp wait',
      { issues: parsedOptions.error.issues },
    );
  }

  const normalizedOptions = parsedOptions.data;
  const timeout = normalizedOptions.timeout ?? 30_000;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throwInvalidTimeout();
  }

  const attachment = await attachReusableClientSurface<WaitCommandOptions, WaitResult>({
    clientSurface: 'wait',
    version: 'wait',
    options: normalizedOptions,
    alwaysTryRest: true,
    rest: (context) => waitForServers(context, timeout),
    // `wait` deliberately has no MCP fallback: /api/v1/inspect is the
    // authenticated client-facing status contract and MCP cannot report the
    // loading states needed to decide whether it is safe to invoke a tool.
    mcp: async () => ({ status: 'error', message: 'The running 1MCP server does not support /api/v1/inspect.' }),
  });

  if (attachment.status === 'auth_required') {
    throw new WaitCommandError(
      'auth_required',
      attachment.message,
      getClientSurfaceAuthRecoveryCommand({
        baseUrl: attachment.baseUrl,
        options: normalizedOptions,
        target: attachment.target,
      }),
    );
  }
  if (attachment.status !== 'success') {
    throw new WaitCommandError('server_status_unavailable', attachment.message, '1mcp inspect');
  }

  const output = formatWaitOutput(attachment.value, normalizedOptions.format ?? 'toon');
  if (output.length > 0) {
    process.stdout.write(`${output}\n`);
  }
}

function throwInvalidTimeout(): never {
  throw new WaitCommandError('validation_timeout', '--timeout must be a positive number of milliseconds.', '1mcp wait');
}

export async function waitForServers(
  context: ClientSurfaceAttachmentContext<WaitCommandOptions>,
  timeout: number,
): Promise<
  | { status: 'success'; value: WaitResult }
  | { status: 'auth_required'; message: string }
  | { status: 'error'; message: string }
> {
  const apiClient = new ApiClient({
    baseUrl: context.baseUrl,
    bearerToken: context.bearerToken,
    sessionId: context.sessionId,
    context: context.context,
  });
  const startedAt = Date.now();
  const deadline = startedAt + timeout;
  let lastServers: InspectServerSummary[] = [];

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throwWaitTimeout(timeout, context.options.server, lastServers);
    }
    const response = await apiClient.get<unknown>(API_INSPECT_ENDPOINT, buildFilterSelectionQuery(context.options), {
      timeout: remaining,
    });
    if (response.status === 401 || response.status === 403) {
      return { status: 'auth_required', message: formatClientSurfaceAuthRequiredMessage(context) };
    }
    if (Date.now() >= deadline) {
      throwWaitTimeout(timeout, context.options.server, lastServers);
    }
    if (!response.ok) {
      return { status: 'error', message: response.error ?? 'Invalid response from /api/v1/inspect.' };
    }
    const parsed = inspectServersResultSchema.safeParse(response.data);
    if (!parsed.success) {
      return { status: 'error', message: 'Invalid response from /api/v1/inspect.' };
    }

    const selected = selectWaitServers(parsed.data.servers, context.options.server);
    lastServers = selected;
    throwForTerminalState(selected, context.options.server);

    if (selected.every((server) => server.status === 'connected' && server.available)) {
      return {
        status: 'success',
        value: { kind: 'wait', servers: selected, waitedMs: Date.now() - startedAt },
      };
    }

    await delay(Math.min(250, Math.max(deadline - Date.now(), 1)));
  }
}

function throwWaitTimeout(timeout: number, server: string | undefined, servers: InspectServerSummary[]): never {
  const target = server ?? 'all configured servers';
  throw new WaitCommandError(
    'server_wait_timeout',
    `Timed out after ${timeout}ms waiting for ${target}.`,
    server ? `1mcp wait ${server}` : '1mcp wait',
    { status: 'timeout', servers },
  );
}

export function selectWaitServers(servers: InspectServerSummary[], target?: string): InspectServerSummary[] {
  if (target) {
    const server = servers.find((candidate) => candidate.server === target);
    if (!server) {
      throw new WaitCommandError('server_not_found', `Server '${target}' was not found.`, `1mcp inspect ${target}`);
    }
    if (!server.loadTracked) {
      throw new WaitCommandError(
        'server_not_load_tracked',
        `Server '${target}' is not a tracked static startup server.`,
        `1mcp inspect ${target}`,
        { server },
      );
    }
    return [server];
  }

  return servers.filter((server) => server.loadTracked);
}

function throwForTerminalState(servers: InspectServerSummary[], requestedServer?: string): void {
  const terminal = servers.find((server) =>
    ['failed', 'cancelled', 'awaiting_oauth', 'disconnected', 'error', 'unknown'].includes(server.status),
  );
  if (!terminal) return;

  if (terminal.status === 'awaiting_oauth') {
    throw new WaitCommandError(
      'server_awaiting_oauth',
      `Server '${terminal.server}' requires OAuth authorization.`,
      `1mcp inspect ${terminal.server}`,
      { server: terminal },
    );
  }

  throw new WaitCommandError(
    'server_unavailable',
    `Server '${terminal.server}' is ${terminal.status}.`,
    `1mcp mcp restart ${requestedServer ?? terminal.server}`,
    { server: terminal },
  );
}

function formatWaitOutput(result: WaitResult, format: NonNullable<WaitCommandOptions['format']>): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  if (format === 'toon') return encode(result);
  if (result.servers.length === 0) return 'No matching tracked static servers.';
  return result.servers.map((server) => `${server.server}: ${server.status}`).join('\n');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
