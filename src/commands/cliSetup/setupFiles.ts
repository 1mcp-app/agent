import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import JSON5 from 'json5';

export const CLI_SETUP_TARGETS = ['codex', 'claude'] as const;
export type CliSetupTarget = (typeof CLI_SETUP_TARGETS)[number];

export const CLI_SETUP_SCOPES = ['global', 'repo', 'all'] as const;
export type CliSetupScope = (typeof CLI_SETUP_SCOPES)[number];

const LEGACY_MANAGED_BLOCK_PATTERN =
  /<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->[\s\S]*?<!-- END 1MCP MANAGED STARTUP DOCS -->\n?/gm;

const MANAGED_COMMAND = '1mcp instructions';
const CODEX_MATCHER = 'startup|resume';

interface ScopePaths {
  scope: Exclude<CliSetupScope, 'all'>;
  rootDir: string;
  codexManagedDocPath: string;
  claudeManagedDocPath: string;
  codexHookPath: string;
  claudeHookPath: string;
  codexStartupPath: string;
  claudeStartupPath: string;
}

interface WriteCliSetupOptions {
  repoRoot: string;
  scope: CliSetupScope;
  targets: CliSetupTarget[];
}

export interface CliSetupWriteResult {
  path: string;
  changed: boolean;
  kind: 'hook' | 'startup-doc' | 'managed-doc';
  target: CliSetupTarget;
  scope: Exclude<CliSetupScope, 'all'>;
}

interface HookCommand {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

interface HookConfig {
  hooks?: {
    SessionStart?: HookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function resolveCliSetupScope(rawScope?: string): CliSetupScope {
  if (!rawScope || rawScope.trim() === '') {
    return 'global';
  }

  const normalizedScope = rawScope.trim().toLowerCase();
  if (!CLI_SETUP_SCOPES.includes(normalizedScope as CliSetupScope)) {
    throw new Error(`Invalid cli-setup scope: ${rawScope}. Expected one of: ${CLI_SETUP_SCOPES.join(', ')}`);
  }

  return normalizedScope as CliSetupScope;
}

export async function writeCliSetupFiles(options: WriteCliSetupOptions): Promise<CliSetupWriteResult[]> {
  const results: CliSetupWriteResult[] = [];
  const managedDocContent = renderManagedDocContent();

  for (const scopePaths of getScopePaths(options.repoRoot, options.scope)) {
    for (const target of options.targets) {
      const isCodex = target === 'codex';
      const managedDocPath = isCodex ? scopePaths.codexManagedDocPath : scopePaths.claudeManagedDocPath;
      const hookPath = isCodex ? scopePaths.codexHookPath : scopePaths.claudeHookPath;
      const startupPath = isCodex ? scopePaths.codexStartupPath : scopePaths.claudeStartupPath;

      results.push(
        ...(await writeTargetSetupFiles(managedDocPath, hookPath, startupPath, isCodex, managedDocContent, {
          target,
          scope: scopePaths.scope,
        })),
      );
    }
  }

  return results;
}

async function writeTargetSetupFiles(
  managedDocPath: string,
  hookPath: string,
  startupPath: string,
  includeMatcher: boolean,
  managedDocContent: string,
  resultInfo: Pick<CliSetupWriteResult, 'target' | 'scope'>,
): Promise<CliSetupWriteResult[]> {
  const existingStartup = await readExistingFile(startupPath);
  const startupContent = upsertStartupDocManagedBlock(
    existingStartup,
    renderStartupDocManagedBlock(startupPath, managedDocPath),
  );

  return Promise.all([
    writeManagedFile(managedDocPath, managedDocContent, { ...resultInfo, kind: 'managed-doc' }),
    writeManagedJson(hookPath, (existing) => upsertHooks(existing, includeMatcher), { ...resultInfo, kind: 'hook' }),
    writeManagedFile(startupPath, startupContent, { ...resultInfo, kind: 'startup-doc' }, existingStartup),
  ]);
}

export function formatCliSetupOutput(results: CliSetupWriteResult[]): string {
  const header = 'Updated 1MCP CLI setup files:';
  const lines = results.map(
    (result) =>
      `- [${result.scope}] ${result.kind} ${result.target}: ${result.path}${result.changed ? '' : ' (unchanged)'}`,
  );
  return [header, ...lines].join('\n');
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
  const relativePath = path.relative(path.dirname(startupDocPath), managedDocPath).replace(/\\/g, '/');
  return `@${relativePath}\n`;
}

export function upsertStartupDocManagedBlock(existingContent: string, managedBlock: string): string {
  const normalizedExisting = existingContent.replace(/\r\n/g, '\n');
  const referenceLine = managedBlock.trim();
  const withoutLegacyBlocks = normalizedExisting.replace(LEGACY_MANAGED_BLOCK_PATTERN, '');
  const remainingLines = withoutLegacyBlocks
    .split('\n')
    .filter((line) => line.trim() !== referenceLine)
    .join('\n')
    .trimEnd();

  if (remainingLines.length === 0) {
    return `${referenceLine}\n`;
  }

  return `${remainingLines}\n${referenceLine}\n`;
}

function getScopePaths(repoRoot: string, scope: CliSetupScope): ScopePaths[] {
  const scopes = scope === 'all' ? (['global', 'repo'] as const) : ([scope] as const);

  return scopes.map((currentScope) => {
    if (currentScope === 'global') {
      const homeDir = os.homedir();
      const codexRoot = path.join(homeDir, '.codex');
      const claudeRoot = path.join(homeDir, '.claude');

      return {
        scope: currentScope,
        rootDir: homeDir,
        codexManagedDocPath: path.join(codexRoot, '1MCP.md'),
        claudeManagedDocPath: path.join(claudeRoot, '1MCP.md'),
        codexHookPath: path.join(codexRoot, 'hooks.json'),
        claudeHookPath: path.join(claudeRoot, 'settings.json'),
        codexStartupPath: path.join(codexRoot, 'AGENTS.md'),
        claudeStartupPath: path.join(claudeRoot, 'CLAUDE.md'),
      };
    }

    const resolvedRepoRoot = path.resolve(repoRoot);
    return {
      scope: currentScope,
      rootDir: resolvedRepoRoot,
      codexManagedDocPath: path.join(resolvedRepoRoot, '.codex', '1MCP.md'),
      claudeManagedDocPath: path.join(resolvedRepoRoot, '.claude', '1MCP.md'),
      codexHookPath: path.join(resolvedRepoRoot, '.codex', 'hooks.json'),
      claudeHookPath: path.join(resolvedRepoRoot, '.claude', 'settings.json'),
      codexStartupPath: path.join(resolvedRepoRoot, 'AGENTS.md'),
      claudeStartupPath: path.join(resolvedRepoRoot, 'CLAUDE.md'),
    };
  });
}

async function writeManagedJson(
  filePath: string,
  updater: (existing: Record<string, unknown>) => Record<string, unknown>,
  resultInfo: Omit<CliSetupWriteResult, 'path' | 'changed'>,
): Promise<CliSetupWriteResult> {
  const existingContent = await readExistingFile(filePath);
  const parsed = parseJsonConfig(existingContent);
  const updated = updater(parsed);
  const nextContent = `${JSON.stringify(updated, null, 2)}\n`;
  const changed = nextContent !== normalizeText(existingContent);

  if (changed) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, nextContent, 'utf8');
  }

  return {
    ...resultInfo,
    path: filePath,
    changed,
  };
}

async function writeManagedFile(
  filePath: string,
  nextContent: string,
  resultInfo: Omit<CliSetupWriteResult, 'path' | 'changed'>,
  existingContent?: string,
): Promise<CliSetupWriteResult> {
  const resolved = existingContent ?? (await readExistingFile(filePath));
  const normalizedNextContent = normalizeText(nextContent);
  const changed = normalizedNextContent !== normalizeText(resolved);

  if (changed) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, normalizedNextContent, 'utf8');
  }

  return {
    ...resultInfo,
    path: filePath,
    changed,
  };
}

function upsertHooks(existing: Record<string, unknown>, includeMatcher: boolean): Record<string, unknown> {
  const config = cloneHookConfig(existing);
  config.hooks ??= {};
  config.hooks.SessionStart = dedupeSessionStartHooks(config.hooks.SessionStart ?? [], includeMatcher);
  return config;
}

function dedupeSessionStartHooks(entries: HookEntry[], includeMatcher: boolean): HookEntry[] {
  const dedupedEntries: HookEntry[] = [];
  let seenManagedHook = false;

  for (const entry of entries) {
    const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
    const nextHooks: HookCommand[] = [];

    for (const hook of hooks) {
      if (isManagedHook(hook)) {
        if (!seenManagedHook) {
          seenManagedHook = true;
          nextHooks.push(hook);
        }
        continue;
      }
      nextHooks.push(hook);
    }

    if (nextHooks.length > 0) {
      dedupedEntries.push({
        ...entry,
        hooks: nextHooks,
      });
    }
  }

  if (!seenManagedHook) {
    dedupedEntries.push(createHookEntry(includeMatcher));
  }

  return dedupedEntries;
}

function createHookEntry(includeMatcher: boolean): HookEntry {
  return {
    ...(includeMatcher ? { matcher: CODEX_MATCHER } : {}),
    hooks: [{ type: 'command', command: MANAGED_COMMAND }],
  };
}

function isManagedHook(hook: HookCommand | undefined): boolean {
  return hook?.type === 'command' && hook.command === MANAGED_COMMAND;
}

function cloneHookConfig(existing: Record<string, unknown>): HookConfig {
  return { ...(existing || {}) } as HookConfig;
}

function parseJsonConfig(content: string): Record<string, unknown> {
  if (content.trim() === '') {
    return {};
  }

  const parsed = JSON5.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object in setup config file.');
  }

  return parsed as Record<string, unknown>;
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

function normalizeText(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function isMissingFileError(error: unknown): error is { code: string } {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
