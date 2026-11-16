import path from 'node:path';

import { fromMarkdown } from 'mdast-util-from-markdown';
import { z } from 'zod';

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
  compactRendered: z.string().optional(),
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

/** Minimal rules shared by installed startup guidance and hook delivery. */
export function renderManagedDocContent(skillPath?: string): string {
  const skill = skillPath ? `[1mcp-cli](<${skillPath.replace(/\\/g, '/')}>)` : '`1mcp-cli`';
  return [
    '# 1MCP Agent Bootstrap',
    '',
    `Before using 1MCP-managed tools, read the ${skill} skill. Load its references only for the current operation.`,
    'If the skill is unavailable, run `1mcp instructions` without --compact and read the full guidance before tool use. Do not install anything automatically.',
    'Route upstream capabilities through the 1MCP CLI. Keep the verified startup or worker assignment and your own caller ownership; overrides do not change the session default. Workers need independent ownership and explicit assignments.',
    'Resolve reported bootstrap coverage gaps before project-specific tool use. Configuration files alone do not prove trusted hooks or runtime readiness.',
    'Compact hook output is an overview, not server instructions. Read `1mcp instructions <server>` before using that server unless current instructions for the same target are already available.',
    '',
  ].join('\n');
}

/** Built-in overview only: custom templates must be delivered intact. */
export function renderCompactInstructions(output: z.infer<typeof instructionsFormattingPayloadSchema>): string {
  const lines = [
    '1MCP server overview',
    'Use the 1mcp-cli skill; if unavailable, read full `1mcp instructions`. Read `1mcp instructions <server>` before tool use.',
  ];
  if (output.servers.length === 0) lines.push('No servers visible for the selected target and filters.');
  const details = new Map(output.details.map((detail) => [detail.server, detail]));
  for (const server of output.servers) {
    const fields = [
      server.server,
      `type=${server.type ?? 'unknown'}`,
      `status=${server.status ?? 'unknown'}`,
      `available=${server.available === undefined ? 'unknown' : server.available}`,
      `load_tracked=${server.loadTracked === undefined ? 'unknown' : server.loadTracked}`,
      `tools=${server.toolCountKnown === false ? 'unknown' : server.toolCount}`,
      `instructions=${server.hasInstructions ? 'yes' : 'no'}`,
    ];
    const note = details.get(server.server)?.note;
    if (note && note !== '(none provided)') fields.push(note);
    lines.push(fields.join(' | '));
  }
  return lines.join('\n');
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
  const { codeLines, unclosedFenceLine } = findStartupDocCode(withoutLegacyBlocks);
  let foundReference = false;
  const updatedLines = withoutLegacyBlocks.split('\n').flatMap((line, index) => {
    if (codeLines.has(index)) return [line];
    if (!managedReferenceAliases.has(line.trim())) return [line];
    if (foundReference) return [];

    foundReference = true;
    return [line.trim() === referenceLine ? line : referenceLine];
  });

  if (foundReference) return updatedLines.join('\n');

  if (unclosedFenceLine !== undefined) {
    updatedLines.splice(unclosedFenceLine, 0, referenceLine);
    return updatedLines.join('\n');
  }

  const remainingLines = updatedLines.join('\n').trimEnd();

  if (remainingLines.length === 0) {
    return `${referenceLine}\n`;
  }

  return `${remainingLines}\n${referenceLine}\n`;
}

function findStartupDocCode(content: string): { codeLines: Set<number>; unclosedFenceLine?: number } {
  const tree = fromMarkdown(content);
  const codeLines = new Set<number>();
  let unclosedFenceLine: number | undefined;

  function visit(node: (typeof tree.children)[number], blockStart: number): void {
    if (node.type === 'code' || node.type === 'inlineCode') {
      const position = node.position!;
      for (let line = position.start.line - 1; line < position.end.line; line++) codeLines.add(line);

      if (node.type !== 'code') return;
      if (position.end.offset! < content.trimEnd().length) return;
      const sourceLines = content.slice(position.start.offset, position.end.offset).split('\n');
      const marker = /^(`{3,}|~{3,})/.exec(sourceLines[0])?.[0];
      if (!marker) return;
      const closingFence = new RegExp(`^\\s*${marker[0]}{${marker.length},}[ \\t]*$`);
      if (sourceLines.length > 1 && closingFence.test(sourceLines.at(-1)!)) return;
      unclosedFenceLine = blockStart;
      return;
    }

    if ('children' in node) {
      for (const child of node.children) visit(child, blockStart);
    }
  }

  for (const node of tree.children) visit(node, node.position!.start.line - 1);
  return { codeLines, unclosedFenceLine };
}
