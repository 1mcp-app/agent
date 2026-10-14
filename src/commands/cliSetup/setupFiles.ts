import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  renderManagedDocContent,
  renderStartupDocManagedBlock,
  renderStartupDocManagedBlockForClient,
  upsertStartupDocManagedBlock,
} from '@src/core/instructions/instructionsDistribution.js';
import logger from '@src/logger/logger.js';

import JSON5 from 'json5';

export const CLI_SETUP_TARGETS = ['codex', 'claude'] as const;
export type CliSetupTarget = (typeof CLI_SETUP_TARGETS)[number];

export const CLI_SETUP_SCOPES = ['global', 'repo', 'all'] as const;
export type CliSetupScope = (typeof CLI_SETUP_SCOPES)[number];

const LEGACY_MANAGED_COMMAND = '1mcp instructions';

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
    SubagentStart?: HookEntry[];
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
  const managedDocContent = renderManagedDocContent();
  const writes = getScopePaths(options.repoRoot, options.scope).flatMap((scopePaths) =>
    options.targets.map(async (target) => {
      const isCodex = target === 'codex';
      const managedDocPath = isCodex ? scopePaths.codexManagedDocPath : scopePaths.claudeManagedDocPath;
      const hookPath = isCodex ? scopePaths.codexHookPath : scopePaths.claudeHookPath;
      const startupPath = isCodex ? scopePaths.codexStartupPath : scopePaths.claudeStartupPath;

      return writeTargetSetupFiles(managedDocPath, hookPath, startupPath, managedDocContent, {
        target,
        scope: scopePaths.scope,
      });
    }),
  );

  return (await Promise.all(writes)).flat();
}

async function writeTargetSetupFiles(
  managedDocPath: string,
  hookPath: string,
  startupPath: string,
  managedDocContent: string,
  resultInfo: Pick<CliSetupWriteResult, 'target' | 'scope'>,
): Promise<CliSetupWriteResult[]> {
  const existingStartup = await readExistingFile(startupPath);
  const startupContent = upsertStartupDocManagedBlock(
    existingStartup,
    renderStartupDocManagedBlockForClient({
      target: resultInfo.target,
      scope: resultInfo.scope,
      startupDocPath: startupPath,
      managedDocPath,
    }),
  );

  return Promise.all([
    writeManagedFile(managedDocPath, managedDocContent, { ...resultInfo, kind: 'managed-doc' }),
    writeManagedJson(hookPath, (existing) => upsertHooks(existing, resultInfo.target), { ...resultInfo, kind: 'hook' }),
    writeManagedFile(startupPath, startupContent, { ...resultInfo, kind: 'startup-doc' }, existingStartup),
  ]);
}

export function formatCliSetupOutput(results: CliSetupWriteResult[]): string {
  const header = 'Updated 1MCP CLI setup files:';
  const lines = results.map(
    (result) =>
      `- [${result.scope}] ${result.kind} ${result.target}: ${result.path}${result.changed ? '' : ' (unchanged)'}`,
  );
  return [
    header,
    ...lines,
    'Hook files configure delivery only. Disabled, untrusted, skipped, or unavailable hooks remain bootstrap coverage gaps. Verify delivery in the selected client.',
  ].join('\n');
}

export { renderManagedDocContent, renderStartupDocManagedBlock, upsertStartupDocManagedBlock };

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
  if (hasJsonComments(existingContent)) {
    logger.warn('setupFiles.skipping.managed.update.for.because.the.file.contains.json.comments.0409427c');
    return {
      ...resultInfo,
      path: filePath,
      changed: false,
    };
  }

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

export function upsertHooks(existing: Record<string, unknown>, target: CliSetupTarget): Record<string, unknown> {
  const config = cloneHookConfig(existing);
  config.hooks ??= {};
  for (const event of ['SessionStart', 'SubagentStart'] as const) {
    const entries = config.hooks[event] ?? [];
    if (!Array.isArray(entries)) throw new Error(`Expected hooks.${event} to be an array`);
    config.hooks[event] = composeBootstrapHooks(entries, target, event);
  }
  return config;
}

function composeBootstrapHooks(entries: HookEntry[], target: CliSetupTarget, event: string): HookEntry[] {
  const preserved: HookEntry[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry?.hooks)) {
      preserved.push(entry);
      continue;
    }
    const nextHooks = entry.hooks.filter((hook) => !isManagedHook(hook, target, event));
    if (nextHooks.length > 0) {
      preserved.push({ ...entry, hooks: nextHooks });
    }
  }
  // Always use an unconditional entry: migrating a restrictive legacy matcher must not exclude workers.
  preserved.push({ hooks: [{ type: 'command', command: managedBootstrapCommand(target, event), timeout: 10 }] });
  return preserved;
}

function managedBootstrapCommand(target: CliSetupTarget, event: string): string {
  return `1mcp bootstrap --client ${target} --event ${event}`;
}

function isManagedHook(hook: HookCommand | undefined, target: CliSetupTarget, event: string): boolean {
  if (hook?.type !== 'command') return false;
  if (hook.command === LEGACY_MANAGED_COMMAND) return true;
  // Explicit custom assignments or shell pipelines are user-owned and must be retained.
  return hook.command === managedBootstrapCommand(target, event);
}

function cloneHookConfig(existing: Record<string, unknown>): HookConfig {
  if (typeof structuredClone === 'function') {
    return structuredClone(existing || {}) as HookConfig;
  }

  return JSON.parse(JSON.stringify(existing || {})) as HookConfig;
}

function hasJsonComments(content: string): boolean {
  return /(^|\n)\s*\/\/|\/\*/m.test(content);
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
