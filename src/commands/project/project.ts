import { resolveAgentSessionOptions } from '@src/commands/shared/agentSession.js';
import { ApiClient } from '@src/commands/shared/apiClient.js';
import {
  attachReusableClientSurface,
  formatClientSurfaceAuthRequiredMessage,
} from '@src/commands/shared/clientSurfaceAttachment.js';
import { buildFilterSelectionQuery } from '@src/commands/shared/filterSelectionQuery.js';
import type { ProjectSelectionOptions } from '@src/commands/shared/projectSelectionOptions.js';
import { usesLocalAgentDefaults } from '@src/commands/shared/serveTargetResolver.js';
import { API_BASE_PATH } from '@src/constants/api.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { z } from 'zod';

export interface ProjectCommandOptions extends GlobalOptions, ProjectSelectionOptions {
  action: 'release' | 'drain' | 'status' | 'resume' | 'recover';
  'wait-ms'?: number;
  'expected-runtime-scope'?: string;
  'terminal-cleanup'?: boolean;
  format?: 'text' | 'json';
  url?: string;
  context?: string;
  preset?: string;
  tags?: string[];
  'tag-filter'?: string;
}

const optionsSchema = z
  .object({
    action: z.enum(['release', 'drain', 'status', 'resume']),
    'wait-ms': z.number().int().min(0).max(60_000).optional(),
    format: z.enum(['text', 'json']).default('text'),
  })
  .superRefine((value, context) => {
    if (value['wait-ms'] !== undefined && value.action !== 'drain') {
      context.addIssue({ code: 'custom', message: '--wait-ms is only accepted for drain' });
    }
  });

export const projectResultSchema = z.object({
  results: z
    .array(
      z
        .object({
          checkoutPath: z.string().min(1),
          admission: z.enum(['open', 'draining']),
          complete: z.boolean(),
          ownerReleased: z.boolean().optional(),
          blockers: z.array(z.object({ kind: z.string(), id: z.string(), count: z.number().optional() }).passthrough()),
        })
        .passthrough(),
    )
    .min(1),
});

export async function projectCommand(options: ProjectCommandOptions): Promise<void> {
  if (options.action === 'recover') {
    if (!options['project-owner']) throw new Error('Recovery requires the ended session --project-owner reference');
    if (options.project || options['project-set'] || options.url || options.context)
      throw new Error('Recovery uses recorded targets; do not supply target selectors');
    const { recoverEndedSessionOwner } = await import('@src/commands/bootstrap/bootstrapOwnership.js');
    const { releaseRecordedOwnerTarget } = await import('@src/commands/bootstrap/bootstrap.js');
    await recoverEndedSessionOwner(options['project-owner'], releaseRecordedOwnerTarget);
    process.stdout.write(`${JSON.stringify({ recovered: true })}\n`);
    return;
  }
  if (usesLocalAgentDefaults(options)) options = await resolveAgentSessionOptions(options);
  const parsed = optionsSchema.parse(options);
  if (parsed.action === 'release' && !options['project-owner']) {
    throw new Error('Release requires --project-owner from this session or worker bootstrap');
  }
  const attachment = await attachReusableClientSurface<ProjectCommandOptions, unknown>({
    clientSurface: 'wait',
    version: 'project',
    options,
    alwaysTryRest: true,
    projectOperator: requiresOperatorCredential(options),
    expectedRuntimeScope: options['expected-runtime-scope'],
    requireProjectOwner: true,
    rest: async (context) => {
      const api = new ApiClient({
        baseUrl: context.baseUrl,
        bearerToken: context.bearerToken,
        sessionId: context.sessionId,
        contextProof: context.contextProof,
      });
      const query = new URLSearchParams(buildFilterSelectionQuery(context.options)).toString();
      const result = await api.post<unknown>(
        `${API_BASE_PATH}/project${query ? `?${query}` : ''}`,
        {
          action: parsed.action,
          waitMs: parsed['wait-ms'],
          _meta: { context: context.context, contextProof: context.contextProof },
        },
        { timeout: (parsed['wait-ms'] ?? 0) + 10_000 },
      );
      if (result.ok && result.data !== undefined) return { status: 'success', value: result.data, restSupport: true };
      if (result.status === 401)
        return { status: 'auth_required', message: result.error ?? 'Authentication is required' };
      return { status: 'error', message: result.error ?? 'Project lifecycle controls are unavailable' };
    },
    mcp: async () => ({ status: 'error', message: 'Project lifecycle controls require the runtime HTTP endpoint' }),
  });
  if (attachment.status === 'auth_required')
    throw new Error(
      `${attachment.message}. ${formatClientSurfaceAuthRequiredMessage({ baseUrl: attachment.baseUrl, options, target: attachment.target })}`,
    );
  if (attachment.status !== 'success') throw new Error(attachment.message);
  const result = projectResultSchema.parse(attachment.value);
  process.stdout.write(`${formatProjectOutput(result, parsed.format, parsed.action)}\n`);
  if (parsed.action === 'release') {
    if (!result.results.every((entry) => entry.ownerReleased === true)) process.exitCode = 1;
    return;
  }
  if (parsed.action === 'drain' && !result.results.every((entry) => entry.complete)) {
    process.exitCode = 1;
  }
}

function requiresOperatorCredential(options: ProjectCommandOptions): boolean {
  if (options.action === 'drain') return true;
  if (options.action === 'resume') return true;
  if (options.action === 'status') return !options['project-owner'];
  return false;
}

export function formatProjectOutput(
  value: unknown,
  format: 'text' | 'json',
  action: ProjectCommandOptions['action'],
): string {
  const result = projectResultSchema.parse(value);
  if (format === 'json') return JSON.stringify(result, null, 2);
  return result.results
    .map((entry) => {
      const blockers = entry.blockers.map(
        (blocker) => `  ${blocker.kind}: ${blocker.id}${blocker.count === undefined ? '' : ` (${blocker.count})`}`,
      );
      const status: string[] = [entry.admission];
      if (action === 'release') {
        status.push(entry.ownerReleased === true ? 'owner released' : 'owner release pending');
      }
      status.push(`cleanup ${entry.complete ? 'complete' : 'pending'}`);
      return [`${entry.checkoutPath}: ${status.join('; ')}`, ...blockers].join('\n');
    })
    .join('\n');
}
