import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';

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

function findNearestAncestorContaining(startDir: string, targetName: string): string | null {
  let currentDir = resolve(startDir);

  while (true) {
    if (existsSync(join(currentDir, targetName))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

async function readProjectConfig(configPath: string): Promise<ProjectConfig | null> {
  try {
    logger.debug(`Loading project config from ${configPath}`);

    const content = await readFile(configPath, 'utf-8');
    const data = JSON5.parse(content) as unknown;
    const config = validateProjectConfig(data);

    logger.info(`📄 Loaded configuration from ${PROJECT_CONFIG_FILE}`, {
      preset: config.preset,
      tags: config.tags,
      filter: config.filter,
    });

    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.warn(`Invalid JSON in ${PROJECT_CONFIG_FILE}: ${error.message}`);
    } else if (error instanceof Error) {
      logger.warn(`Failed to load ${PROJECT_CONFIG_FILE}: ${error.message}`);
    } else {
      logger.warn(`Failed to load ${PROJECT_CONFIG_FILE}: Unknown error`);
    }
    return null;
  }
}

export async function resolveProjectContext(cwd: string = process.cwd()): Promise<ResolvedProjectContext> {
  const resolvedCwd = resolve(cwd);
  const configDir = findNearestAncestorContaining(resolvedCwd, PROJECT_CONFIG_FILE);

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

  const repoRoot = findNearestAncestorContaining(resolvedCwd, GIT_DIRECTORY_NAME);
  if (repoRoot) {
    logger.debug(`No ${PROJECT_CONFIG_FILE} found for ${resolvedCwd}, using repository root ${repoRoot}`);
    return {
      cwd: resolvedCwd,
      projectRoot: repoRoot,
      projectName: basename(repoRoot) || 'unknown',
      projectConfig: null,
      source: 'repo-root',
    };
  }

  logger.debug(`No ${PROJECT_CONFIG_FILE} or repository root found for ${resolvedCwd}, using cwd`);
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
