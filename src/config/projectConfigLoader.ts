import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

import logger from '@src/logger/logger.js';

import JSON5 from 'json5';

import { ProjectConfig, validateProjectConfig } from './projectConfigTypes.js';

/**
 * Project configuration file name
 */
export const PROJECT_CONFIG_FILE = '.1mcprc';

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
  const configPath = resolve(cwd, PROJECT_CONFIG_FILE);

  // Check if file exists
  if (!existsSync(configPath)) {
    logger.debug(`No ${PROJECT_CONFIG_FILE} found in ${cwd}`);
    return null;
  }

  try {
    logger.debug(`Loading project config from ${configPath}`);

    // Read and parse JSON
    const content = await readFile(configPath, 'utf-8');
    const data = JSON5.parse(content) as unknown;

    // Validate with Zod schema
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
