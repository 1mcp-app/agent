import path from 'node:path';

import { INSPECTION_GUIDANCE } from '@src/core/instructions/inspectionGuidance.js';

import { z } from 'zod';

import { PREPARATION_GUIDANCE } from './preparationGuidance.js';
import { SESSION_GUIDANCE } from './sessionGuidance.js';

const instructionServerSummarySchema = z.object({
  server: z.string(),
  type: z.string().optional(),
  status: z.string().optional(),
  available: z.boolean().optional(),
  loadTracked: z.boolean().optional(),
  toolCount: z.number().int().nonnegative(),
  toolCountKnown: z.boolean().optional(),
  hasInstructions: z.boolean(),
});

const instructionServerDetailSchema = instructionServerSummarySchema.extend({
  instructions: z.string().nullable().optional(),
  note: z.string().optional(),
});

export const instructionsFormattingPayloadSchema = z.object({
  servers: z.array(instructionServerSummarySchema),
  details: z.array(instructionServerDetailSchema),
});

export const instructionsRenderResponseSchema = z.object({
  rendered: z.string(),
  templateIdentity: z.string().min(1),
  fallback: z.boolean(),
  fallbackReason: z.literal('managed_template_render_failed').optional(),
  formatting: instructionsFormattingPayloadSchema.optional(),
});

export type InstructionsRenderResponse = z.infer<typeof instructionsRenderResponseSchema>;

export interface InstructionServerSummary {
  server: string;
  type?: string;
  status?: string;
  available?: boolean;
  loadTracked?: boolean;
  toolCount: number;
  toolCountKnown?: boolean;
  hasInstructions: boolean;
}

export interface InstructionServerInspectResult {
  kind: 'server';
  server: string;
  type?: string;
  status?: string;
  available?: boolean;
  instructions?: string | null;
  tools: unknown[];
  totalTools?: number;
}

export interface NonServerInstructionInspectResult {
  kind: Exclude<string, 'server'>;
}

export interface InstructionServerDetail extends InstructionServerSummary {
  instructions?: string | null;
  note?: string;
}

export interface AssembleInstructionDetailInput {
  summary: InstructionServerSummary;
  inspected?: InstructionServerInspectResult;
  cachedInstructions?: string;
  inspectFailed?: boolean;
}

export interface CollectInstructionDetailsInput {
  servers: InstructionServerSummary[];
  cachedInstructions?: Record<string, string>;
  inspectServer: (server: string) => Promise<InstructionServerInspectResult | NonServerInstructionInspectResult>;
}

export type InstructionsDistributionTarget = 'codex' | 'claude';
export type InstructionsDistributionScope = 'global' | 'repo';

export interface RenderStartupDocManagedBlockInput {
  target: InstructionsDistributionTarget;
  scope: InstructionsDistributionScope;
  startupDocPath: string;
  managedDocPath: string;
}

const LEGACY_MANAGED_BLOCK_PATTERN =
  /<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->[\s\S]*?<!-- END 1MCP MANAGED STARTUP DOCS -->\n?/gm;

export function shouldEagerlyInspectServer(server: InstructionServerSummary): boolean {
  if (server.type === 'template') {
    return true;
  }

  return server.available !== false && server.status !== 'disconnected';
}

export function assembleInstructionDetail(input: AssembleInstructionDetailInput): InstructionServerDetail {
  const { summary, inspected } = input;

  if (inspected) {
    return {
      server: inspected.server,
      type: inspected.type,
      status: inspected.status,
      available: inspected.available,
      toolCount: inspected.totalTools ?? inspected.tools.length,
      hasInstructions: Boolean(inspected.instructions?.trim()),
      instructions: inspected.instructions,
      note: inspected.instructions ? undefined : '(none provided)',
    };
  }

  return {
    server: summary.server,
    type: summary.type,
    status: summary.status,
    available: summary.available,
    toolCount: summary.toolCount,
    hasInstructions: summary.hasInstructions,
    instructions: input.inspectFailed ? null : input.cachedInstructions,
    note:
      summary.type === 'template' && input.inspectFailed
        ? '(unavailable: template server could not be initialized with the current context)'
        : '(unavailable: server is not currently connected)',
  };
}

export async function collectInstructionDetails(
  input: CollectInstructionDetailsInput,
): Promise<InstructionServerDetail[]> {
  const details: InstructionServerDetail[] = [];
  const cachedInstructions = input.cachedInstructions ?? {};

  for (const server of input.servers) {
    if (!shouldEagerlyInspectServer(server)) {
      details.push(
        assembleInstructionDetail({ summary: server, cachedInstructions: cachedInstructions[server.server] }),
      );
      continue;
    }

    try {
      const inspected = await input.inspectServer(server.server);
      if (!isInstructionServerInspectResult(inspected)) {
        details.push(assembleUnavailableDetail(server));
        continue;
      }

      details.push(assembleInstructionDetail({ summary: server, inspected }));
    } catch {
      details.push(assembleInstructionDetail({ summary: server, inspectFailed: true }));
    }
  }

  return details;
}

function isInstructionServerInspectResult(
  inspected: InstructionServerInspectResult | NonServerInstructionInspectResult,
): inspected is InstructionServerInspectResult {
  return inspected.kind === 'server';
}

function assembleUnavailableDetail(server: InstructionServerSummary): InstructionServerDetail {
  return {
    server: server.server,
    type: server.type,
    status: server.status,
    available: server.available,
    toolCount: server.toolCount,
    hasInstructions: server.hasInstructions,
    instructions: null,
    note: '(unavailable)',
  };
}

export function renderManagedDocContent(): string {
  return [
    '# 1MCP Agent Bootstrap',
    '',
    'If this session already received the current 1MCP instructions content from hooks, do not run `1mcp instructions` again. Reuse it only for the same assigned target.',
    'Otherwise, run `1mcp instructions` before using any 1MCP-managed MCP servers.',
    'Use the 1MCP CLI for upstream capabilities; never call replaced servers directly. Config files alone do not prove trusted hooks or runtime readiness.',
    '',
    '## Tool workflow',
    '',
    '1. Review server instructions. If the provider/tool is unknown, search with `1mcp inspect --search <query>` or `1mcp inspect <server> --search <query>`. When the target is known, skip discovery.',
    '2. Run `1mcp instructions <server>` when its instructions are missing; read its applicable instructions.',
    '3. Inspect unknown schemas with `1mcp inspect <server>/<tool>`.',
    "4. Invoke with `1mcp run <server>/<tool> --args '<json>'`.",
    '',
    'Server metadata uses `type: external` for static servers and `type: template` for dynamic servers. Narrow the server set with `--preset`, `--tags` or `--tag-filter`.',
    '',
    'Search is case-insensitive literal substring matching on server/tool references. Use `--search "filesystem/*read?" --glob` for whole-reference matching (`*` and `?` only).',
    '`--include-descriptions` also matches effective descriptions; `--show-descriptions` independently displays descriptions without changing matches.',
    '',
    INSPECTION_GUIDANCE,
    '',
    SESSION_GUIDANCE,
    '',
    PREPARATION_GUIDANCE,
    '',
  ].join('\n');
}

export function renderStartupDocManagedBlock(startupDocPath: string, managedDocPath: string): string {
  if (path.basename(startupDocPath) === 'AGENTS.md' && path.dirname(startupDocPath) === path.dirname(managedDocPath)) {
    return `@${managedDocPath.replace(/\\/g, '/')}\n`;
  }

  const relativePath = path.relative(path.dirname(startupDocPath), managedDocPath).replace(/\\/g, '/');
  return `@${relativePath}\n`;
}

export function renderStartupDocManagedBlockForClient(input: RenderStartupDocManagedBlockInput): string {
  if (input.target === 'codex' && input.scope === 'global') {
    return `@${input.managedDocPath.replace(/\\/g, '/')}\n`;
  }

  const relativePath = path.relative(path.dirname(input.startupDocPath), input.managedDocPath).replace(/\\/g, '/');
  return `@${relativePath}\n`;
}

export function upsertStartupDocManagedBlock(existingContent: string, managedBlock: string): string {
  const normalizedExisting = existingContent.replace(/\r\n/g, '\n');
  const referenceLine = managedBlock.trim();
  const managedReferenceAliases = new Set([referenceLine]);

  if (referenceLine.startsWith('@/') && referenceLine.endsWith('/1MCP.md')) {
    managedReferenceAliases.add('@1MCP.md');
  }

  const withoutLegacyBlocks = normalizedExisting.replace(LEGACY_MANAGED_BLOCK_PATTERN, '');
  let foundReference = false;
  const updatedContent = withoutLegacyBlocks
    .split('\n')
    .flatMap((line) => {
      if (!managedReferenceAliases.has(line.trim())) return [line];
      if (foundReference) return [];

      foundReference = true;
      return [line.trim() === referenceLine ? line : referenceLine];
    })
    .join('\n');

  if (foundReference) return updatedContent;

  const remainingLines = updatedContent.trimEnd();

  if (remainingLines.length === 0) {
    return `${referenceLine}\n`;
  }

  return `${remainingLines}\n${referenceLine}\n`;
}
