import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const STARTUP_DOC_TARGETS = ['agents', 'claude'] as const;
export type StartupDocTarget = (typeof STARTUP_DOC_TARGETS)[number];

export const STARTUP_DOC_FILENAMES: Record<StartupDocTarget, string> = {
  agents: 'AGENTS.md',
  claude: 'CLAUDE.md',
};

export const STARTUP_DOC_BLOCK_START = '<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->';
export const STARTUP_DOC_BLOCK_END = '<!-- END 1MCP MANAGED STARTUP DOCS -->';

const MANAGED_BLOCK_PATTERN = new RegExp(
  `${escapeRegExp(STARTUP_DOC_BLOCK_START)}[\\s\\S]*?${escapeRegExp(STARTUP_DOC_BLOCK_END)}\\n?`,
  'm',
);

interface WriteStartupDocsOptions {
  repoRoot: string;
  targets: StartupDocTarget[];
}

export interface StartupDocWriteResult {
  path: string;
  target: StartupDocTarget;
  changed: boolean;
}

export function resolveStartupDocTargets(rawTargets?: string): StartupDocTarget[] {
  if (!rawTargets || rawTargets.trim() === '') {
    return [...STARTUP_DOC_TARGETS];
  }

  const targets = Array.from(
    new Set(
      rawTargets
        .split(',')
        .map((target) => target.trim().toLowerCase())
        .filter((target) => target.length > 0),
    ),
  );

  if (targets.length === 0) {
    return [...STARTUP_DOC_TARGETS];
  }

  const invalidTargets = targets.filter(
    (target): target is string => !STARTUP_DOC_TARGETS.includes(target as StartupDocTarget),
  );
  if (invalidTargets.length > 0) {
    throw new Error(
      `Invalid startup doc target(s): ${invalidTargets.join(', ')}. Expected one of: ${STARTUP_DOC_TARGETS.join(', ')}`,
    );
  }

  return targets as StartupDocTarget[];
}

export function renderStartupDocManagedBlock(): string {
  return [
    STARTUP_DOC_BLOCK_START,
    '# 1MCP Agent Bootstrap',
    '',
    'Always use the 1MCP CLI as the entrypoint for upstream MCP capabilities. Do not call replaced upstream MCP servers directly when 1MCP is available for this repo.',
    '',
    'Required workflow:',
    '1. Run `1mcp instructions` at the beginning of the session.',
    '2. Review the available servers and choose the one that matches the task.',
    '3. Run `1mcp inspect <server>` before selecting a tool.',
    '4. Run `1mcp inspect <server>/<tool>` before invoking that tool.',
    "5. Run `1mcp run <server>/<tool> --args '<json>'` only after inspecting the tool schema.",
    '',
    'Use `--preset`, `--tags`, or `--tag-filter` with `1mcp instructions`, `inspect`, and `run` when you need a narrower server set.',
    STARTUP_DOC_BLOCK_END,
    '',
  ].join('\n');
}

export function upsertStartupDocManagedBlock(existingContent: string, managedBlock: string): string {
  const normalizedExisting = existingContent.replace(/\r\n/g, '\n');

  if (MANAGED_BLOCK_PATTERN.test(normalizedExisting)) {
    return normalizedExisting.replace(MANAGED_BLOCK_PATTERN, managedBlock);
  }

  if (normalizedExisting.trim().length === 0) {
    return managedBlock;
  }

  return `${managedBlock}\n${normalizedExisting}`;
}

export async function writeStartupDocs(options: WriteStartupDocsOptions): Promise<StartupDocWriteResult[]> {
  const repoRoot = path.resolve(options.repoRoot);
  const managedBlock = renderStartupDocManagedBlock();

  await mkdir(repoRoot, { recursive: true });

  const results: StartupDocWriteResult[] = [];
  for (const target of options.targets) {
    const filePath = path.join(repoRoot, STARTUP_DOC_FILENAMES[target]);
    const existingContent = await readExistingFile(filePath);
    const nextContent = upsertStartupDocManagedBlock(existingContent, managedBlock);
    const changed = nextContent !== existingContent.replace(/\r\n/g, '\n');

    if (changed) {
      await writeFile(filePath, nextContent, 'utf8');
    }

    results.push({
      path: filePath,
      target,
      changed,
    });
  }

  return results;
}

export function formatStartupDocsOutput(results: StartupDocWriteResult[]): string {
  const header = 'Updated 1MCP startup docs:';
  const lines = results.map((result) => `- ${result.path}${result.changed ? '' : ' (unchanged)'}`);
  return [header, ...lines].join('\n');
}

async function readExistingFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return '';
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): error is { code: string } {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
