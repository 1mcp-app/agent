import path from 'node:path';

export interface InstructionServerSummary {
  server: string;
  type?: string;
  status?: string;
  available?: boolean;
  toolCount: number;
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

export function renderManagedDocContent(): string {
  return [
    '# 1MCP Agent Bootstrap',
    '',
    'If this session already received the current 1MCP instructions content from hooks, do not run `1mcp instructions` again.',
    'Otherwise, run `1mcp instructions` before using any 1MCP-managed MCP servers.',
    '',
    'Always use the 1MCP CLI as the entrypoint for upstream MCP capabilities. Do not call replaced upstream MCP servers directly when 1MCP is available.',
    '',
    'Required workflow after you have the instructions content:',
    '1. Review the available servers and choose the one that matches the task.',
    '2. Run `1mcp inspect <server>` before selecting a tool.',
    '3. Run `1mcp inspect <server>/<tool>` before invoking that tool.',
    "4. Run `1mcp run <server>/<tool> --args '<json>'` only after inspecting the tool schema.",
    '',
    'Use `--preset`, `--tags`, or `--tag-filter` with `1mcp instructions`, `inspect`, and `run` when you need a narrower server set.',
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

export function upsertStartupDocManagedBlock(existingContent: string, managedBlock: string): string {
  const normalizedExisting = existingContent.replace(/\r\n/g, '\n');
  const referenceLine = managedBlock.trim();
  const managedReferenceAliases = new Set([referenceLine]);

  if (referenceLine.startsWith('@/') && referenceLine.endsWith('/1MCP.md')) {
    managedReferenceAliases.add('@1MCP.md');
  }

  const withoutLegacyBlocks = normalizedExisting.replace(LEGACY_MANAGED_BLOCK_PATTERN, '');
  const remainingLines = withoutLegacyBlocks
    .split('\n')
    .filter((line) => !managedReferenceAliases.has(line.trim()))
    .join('\n')
    .trimEnd();

  if (remainingLines.length === 0) {
    return `${referenceLine}\n`;
  }

  return `${remainingLines}\n${referenceLine}\n`;
}
