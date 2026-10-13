import { access, readFile, realpath } from 'fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, join, resolve } from 'path';

import { writeLocalDiagnostic } from '@src/logger/localDiagnostics.js';
import logger from '@src/logger/logger.js';

import JSON5 from 'json5';

import { ProjectConfig, validateProjectConfig } from './projectConfigTypes.js';

/**
 * Project configuration file name
 */
export const PROJECT_CONFIG_FILE = '.1mcprc';
const GIT_DIRECTORY_NAME = '.git';
const execFileAsync = promisify(execFile);

export interface ResolvedProjectContext {
  cwd: string;
  projectRoot: string;
  projectName: string;
  projectConfigPath?: string;
  /** Repository checkout root, independent of the configuration directory. */
  repositoryRoot?: string;
  projectConfigDir?: string;
  projectConfigSource?: 'local' | 'inherited';
  projectConfig: ProjectConfig | null;
  source: 'project-config' | 'repo-root' | 'cwd';
}

async function findNearestAncestorContaining(
  startDir: string,
  targetName: string,
  boundary?: string,
): Promise<string | null> {
  let currentDir = resolve(startDir);

  while (true) {
    if (await pathExists(join(currentDir, targetName))) {
      return currentDir;
    }

    if (currentDir === boundary) {
      return null;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readProjectConfig(configPath: string): Promise<ProjectConfig | null> {
  try {
    logger.debug('projectConfigLoader.loading.project.config.from.fb26173f');

    const content = await readFile(configPath, 'utf-8');
    const data = JSON5.parse(content) as unknown;
    const config = validateProjectConfig(data);

    logger.info('projectConfigLoader.loaded.configuration.from.278ccfdb');
    writeLocalDiagnostic('info', 'config.project.loaded', { source: configPath, outcome: 'loaded' });

    return config;
  } catch (error) {
    writeLocalDiagnostic('warn', 'config.project.rejected', () => ({
      source: configPath,
      outcome: 'ignored',
      errorType: error instanceof Error ? 'Error' : 'unknown',
    }));
    if (error instanceof SyntaxError) {
      logger.warn('projectConfigLoader.invalid.json.in.db426689', { error: error });
    } else if (error instanceof Error) {
      logger.warn('projectConfigLoader.failed.to.load.470dad92', { error: error });
    } else {
      logger.warn('projectConfigLoader.failed.to.load.unknown.error.8b999c8e', { error: error });
    }
    return null;
  }
}

async function readGitOutput(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function getCommonGitDirectory(checkout: string): Promise<string> {
  const output = await readGitOutput(checkout, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return realpath(output.replace(/\r?\n$/, ''));
}

async function validateMainCheckout(candidate: string, commonGitDir: string): Promise<string | null> {
  if (!(await pathExists(join(candidate, GIT_DIRECTORY_NAME)))) {
    return null;
  }
  if ((await getCommonGitDirectory(candidate)) !== commonGitDir) {
    return null;
  }
  return realpath(candidate);
}

/** Use Git metadata without assuming the common Git directory's parent is the source checkout. */
async function findMainCheckout(repoRoot: string): Promise<string | null> {
  try {
    const stdout = await readGitOutput(repoRoot, ['worktree', 'list', '--porcelain', '-z']);
    // Git lists the main worktree first. NUL fields preserve spaces and newlines in paths.
    const fields = stdout.split('\0');
    const firstRecordEnd = fields.indexOf('');
    const mainRecord = firstRecordEnd < 0 ? fields : fields.slice(0, firstRecordEnd);
    if (mainRecord.includes('bare')) {
      return null;
    }
    const mainField = mainRecord[0];
    if (!mainField?.startsWith('worktree ')) {
      return null;
    }
    const checkout = await realpath(repoRoot);
    const registeredMain = await realpath(mainField.slice('worktree '.length));
    if (registeredMain === checkout) {
      return null;
    }
    // Inherit only for an actual registered linked checkout, never an arbitrary .git marker.
    let registeredCheckout = false;
    for (const field of fields) {
      if (!field.startsWith('worktree ')) {
        continue;
      }
      try {
        if ((await realpath(field.slice('worktree '.length))) === checkout) {
          registeredCheckout = true;
          break;
        }
      } catch {
        // A stale registry entry does not invalidate another registered checkout.
      }
    }
    if (!registeredCheckout) {
      return null;
    }
    const commonGitDir = await getCommonGitDirectory(repoRoot);
    const mainCheckout = await validateMainCheckout(registeredMain, commonGitDir);
    if (mainCheckout) {
      return mainCheckout;
    }
    // Separate-git-dir registries can name the metadata directory as the main worktree.
    // Query the main Git directory so Git selects its config.worktree when enabled,
    // or the common configuration otherwise. Never use the linked checkout's override.
    const worktreeConfigEnabled = await readGitOutput(repoRoot, [
      '--git-dir',
      commonGitDir,
      'config',
      '--local',
      '--type=bool',
      '--default=false',
      '--get',
      'extensions.worktreeConfig',
    ]);
    const configScope = worktreeConfigEnabled.replace(/\r?\n$/, '') === 'true' ? '--worktree' : '--local';
    const configuredWorktree = await readGitOutput(repoRoot, [
      '--git-dir',
      commonGitDir,
      'config',
      configScope,
      '--path',
      '--get',
      'core.worktree',
    ]);
    return await validateMainCheckout(resolve(commonGitDir, configuredWorktree.replace(/\r?\n$/, '')), commonGitDir);
  } catch {
    // Missing Git, invalid metadata, or unavailable main checkout must not change the target.
    return null;
  }
}

export async function resolveProjectContext(cwd: string = process.cwd()): Promise<ResolvedProjectContext> {
  const resolvedCwd = resolve(cwd);
  const repoRoot = await findNearestAncestorContaining(resolvedCwd, GIT_DIRECTORY_NAME);
  const localConfigDir = await findNearestAncestorContaining(resolvedCwd, PROJECT_CONFIG_FILE, repoRoot ?? undefined);
  let configDir = localConfigDir;
  let projectConfigSource: 'local' | 'inherited' = 'local';

  if (!configDir && repoRoot) {
    const mainCheckout = await findMainCheckout(repoRoot);
    if (mainCheckout && (await pathExists(join(mainCheckout, PROJECT_CONFIG_FILE)))) {
      configDir = mainCheckout;
      projectConfigSource = 'inherited';
    }
  }

  const projectRoot = repoRoot ?? localConfigDir ?? resolvedCwd;
  const context: ResolvedProjectContext = {
    cwd: resolvedCwd,
    projectRoot,
    projectName: basename(projectRoot) || 'unknown',
    ...(repoRoot ? { repositoryRoot: repoRoot } : {}),
    projectConfig: null,
    source: repoRoot ? 'repo-root' : 'cwd',
  };

  if (!configDir) {
    return context;
  }

  const projectConfigPath = join(configDir, PROJECT_CONFIG_FILE);
  return {
    ...context,
    projectConfigPath,
    projectConfigDir: configDir,
    projectConfigSource,
    projectConfig: await readProjectConfig(projectConfigPath),
    source: 'project-config',
  };
}

/**
 * Load project configuration from .1mcprc file
 *
 * Searches for .1mcprc in the current working directory.
 * Returns null if file doesn't exist or is invalid.
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns ProjectConfig or null if not found/invalid
 */
export async function loadProjectConfig(cwd: string = process.cwd()): Promise<ProjectConfig | null> {
  const resolvedProjectContext = await resolveProjectContext(cwd);
  return resolvedProjectContext.projectConfig;
}

/**
 * Normalize tags to array format
 *
 * Converts string (comma-separated) or array to normalized array.
 *
 * @param tags - Tags as string or array
 * @returns Normalized array of tags
 */
export function normalizeTags(tags: string | string[] | undefined): string[] | undefined {
  if (!tags) {
    return undefined;
  }

  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  return tags.filter((tag) => tag.length > 0);
}
