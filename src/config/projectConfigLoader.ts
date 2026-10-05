import { access, readFile } from 'fs/promises';
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

export interface ResolvedProjectContext {
  cwd: string;
  projectRoot: string;
  projectName: string;
  projectConfigPath?: string;
  projectConfig: ProjectConfig | null;
  source: 'project-config' | 'repo-root' | 'cwd';
}

async function findNearestAncestorContaining(startDir: string, targetName: string): Promise<string | null> {
  let currentDir = resolve(startDir);

  while (true) {
    if (await pathExists(join(currentDir, targetName))) {
      return currentDir;
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

export async function resolveProjectContext(cwd: string = process.cwd()): Promise<ResolvedProjectContext> {
  const resolvedCwd = resolve(cwd);
  const configDir = await findNearestAncestorContaining(resolvedCwd, PROJECT_CONFIG_FILE);

  if (configDir) {
    const projectConfigPath = join(configDir, PROJECT_CONFIG_FILE);
    return {
      cwd: resolvedCwd,
      projectRoot: configDir,
      projectName: basename(configDir) || 'unknown',
      projectConfigPath,
      projectConfig: await readProjectConfig(projectConfigPath),
      source: 'project-config',
    };
  }

  const repoRoot = await findNearestAncestorContaining(resolvedCwd, GIT_DIRECTORY_NAME);
  if (repoRoot) {
    logger.debug('projectConfigLoader.no.found.for.using.repository.root.413dc0c6');
    return {
      cwd: resolvedCwd,
      projectRoot: repoRoot,
      projectName: basename(repoRoot) || 'unknown',
      projectConfig: null,
      source: 'repo-root',
    };
  }

  logger.debug('projectConfigLoader.no.or.repository.root.found.for.using.cwd.51d43561');
  return {
    cwd: resolvedCwd,
    projectRoot: resolvedCwd,
    projectName: basename(resolvedCwd) || 'unknown',
    projectConfig: null,
    source: 'cwd',
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
