import { ApiClient } from '@src/commands/shared/apiClient.js';
import {
  attachReusableClientSurface,
  formatClientSurfaceAuthRequiredMessage,
} from '@src/commands/shared/clientSurfaceAttachment.js';
import { buildFilterSelectionQuery } from '@src/commands/shared/filterSelectionQuery.js';
import { API_BASE_PATH } from '@src/constants/api.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { z } from 'zod';

export interface PreparationCommandOptions extends GlobalOptions {
  action?: 'prepare' | 'status' | 'wait' | 'cancel' | 'retry';
  backend?: string;
  id?: string;
  operation?: string;
  'wait-ms'?: number;
  url?: string;
  context?: string;
  preset?: string;
  tags?: string[];
  'tag-filter'?: string;
  format?: 'text' | 'json';
}

const optionsSchema = z
  .object({
    action: z.enum(['prepare', 'status', 'wait', 'cancel', 'retry']),
    backend: z.string().trim().min(1).max(256),
    id: z.string().uuid().optional(),
    operation: z.string().min(1).max(256).optional(),
    'wait-ms': z.number().int().min(0).max(3_600_000).optional(),
    format: z.enum(['text', 'json']).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (['wait', 'cancel'].includes(value.action) && !value.id)
      context.addIssue({ code: 'custom', message: 'wait and cancel require an operation id' });
    if (value.action === 'prepare' && value.id)
      context.addIssue({ code: 'custom', message: 'prepare does not accept an operation id' });
    if (value['wait-ms'] !== undefined && value.action !== 'wait')
      context.addIssue({ code: 'custom', message: '--wait-ms is only accepted for wait' });
  });

export async function preparationCommand(options: PreparationCommandOptions): Promise<void> {
  const parsed = optionsSchema.parse(options);
  const attachment = await attachReusableClientSurface<PreparationCommandOptions, unknown>({
    // Reuses attachment/auth/proof/cache logic. This surface has no upstream MCP fallback.
    clientSurface: 'wait',
    version: 'preparation',
    options,
    alwaysTryRest: true,
    rest: async (context) => {
      const api = new ApiClient({
        baseUrl: context.baseUrl,
        bearerToken: context.bearerToken,
        sessionId: context.sessionId,
        contextProof: context.contextProof,
      });
      const query = new URLSearchParams(buildFilterSelectionQuery(context.options)).toString();
      const result = await api.post<unknown>(
        `${API_BASE_PATH}/preparation${query ? `?${query}` : ''}`,
        {
          action: parsed.action,
          backend: parsed.backend,
          id: parsed.id,
          operation: parsed.operation,
          waitMs: parsed['wait-ms'],
          _meta: { context: context.context, contextProof: context.contextProof },
        },
        { timeout: (parsed['wait-ms'] ?? 5_000) + 10_000 },
      );
      if (result.ok && result.data !== undefined)
        return { status: 'success', value: result.data, sessionId: result.sessionId, restSupport: true };
      if (result.status === 401)
        return { status: 'auth_required', message: result.error ?? 'Authentication is required' };
      return { status: 'error', message: result.error ?? 'Preparation controls are unavailable on this runtime' };
    },
    mcp: async () => ({
      status: 'error',
      message: 'Preparation requires the runtime HTTP preparation endpoint; no upstream operation was executed.',
    }),
  });
  if (attachment.status === 'auth_required')
    throw new Error(
      `${attachment.message}. ${formatClientSurfaceAuthRequiredMessage({ baseUrl: attachment.baseUrl, options, target: attachment.target })}`,
    );
  if (attachment.status !== 'success') throw new Error(attachment.message);
  process.stdout.write(`${formatPreparationOutput(attachment.value, parsed.format ?? 'text')}\n`);
}

export function formatPreparationOutput(value: unknown, format: 'text' | 'json'): string {
  if (format === 'json') return JSON.stringify(value, null, 2);
  if (typeof value !== 'object' || value === null) throw new Error('Invalid preparation response');
  const record = value as Record<string, unknown>;
  if (record.state === 'job') return formatPreparationOutput(record.status, format);
  const target = record.target as { backendName?: string } | undefined;
  const id = typeof record.id === 'string' ? ` (${record.id})` : '';
  const prefix = target?.backendName ? `${target.backendName}: ` : '';
  const instructions = typeof record.instructions === 'string' ? `\n${record.instructions}` : '';
  const failure = record.failure as { instructions?: string } | undefined;
  const recovery = failure?.instructions ? `\n${failure.instructions}` : '';
  return `${prefix}${String(record.state)}${id}${instructions}${recovery}`;
}
