import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import logger from '../logger/logger.js';

/**
 * Configuration for environment processing
 */
export interface EnvProcessingConfig {
  readonly inheritParentEnv?: boolean;
  readonly envFilter?: string[];
  readonly env?: Record<string, string> | string[];
}

/**
 * Result of environment processing
 */
export interface ProcessedEnvironment {
  readonly processedEnv: Record<string, string>;
  readonly sources: {
    readonly sdkDefaults: string[];
    readonly inherited: string[];
    readonly custom: string[];
    readonly filtered: string[];
  };
}

/**
 * Converts environment array format to object format
 * @param envArray Array in format ["KEY=value", "PATH=/usr/bin"]
 * @returns Object in format {KEY: "value", PATH: "/usr/bin"}
 */
export function parseEnvArray(envArray: string[]): Record<string, string> {
  const envObject: Record<string, string> = {};

  for (const entry of envArray) {
    const equalIndex = entry.indexOf('=');
    if (equalIndex === -1) {
      // No equals sign, treat as inheritance key
      const key = entry.trim();
      const value = process.env[key];
      if (value !== undefined) {
        envObject[key] = value;
      }
    } else {
      // Has equals sign, treat as key=value assignment
      const key = entry.slice(0, equalIndex).trim();
      const value = entry.slice(equalIndex + 1);
      envObject[key] = value;
    }
  }

  return envObject;
}

/**
 * Checks if an environment variable key matches any pattern
 * @param key Environment variable key
 * @param patterns Array of patterns with optional ! prefix for denial
 * @returns true if key should be included, false if denied or not matched
 */
function matchesEnvPattern(key: string, patterns: string[]): boolean {
  let matched = false;
  let denied = false;

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      // Denial pattern
      const denyPattern = pattern.slice(1);
      if (matchesGlobPattern(key, denyPattern)) {
        denied = true;
      }
    } else {
      // Allow pattern
      if (matchesGlobPattern(key, pattern)) {
        matched = true;
      }
    }
  }

  // If explicitly denied, return false
  // If matched by allow pattern and not denied, return true
  // If no allow patterns specified but denied patterns exist, default to true unless denied
  if (denied) return false;
  if (matched) return true;

  // Check if there are any allow patterns - if not, default to allow (only deny patterns)
  const hasAllowPatterns = patterns.some((p) => !p.startsWith('!'));
  return !hasAllowPatterns;
}

/**
 * Simple glob pattern matching for environment variable names
 * Supports * wildcard at the end of patterns
 * @param text Text to match
 * @param pattern Pattern with optional * wildcard
 * @returns true if text matches pattern
 */
function matchesGlobPattern(text: string, pattern: string): boolean {
  if (pattern === text) {
    return true;
  }

  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return text.startsWith(prefix);
  }

  return false;
}

/**
 * Applies environment variable filtering based on patterns
 * @param env Environment variables to filter
 * @param patterns Array of allow/deny patterns
 * @returns Filtered environment variables and list of filtered keys
 */
function applyEnvPatterns(
  env: Record<string, string>,
  patterns: string[],
): { filtered: Record<string, string>; filteredKeys: string[] } {
  const filtered: Record<string, string> = {};
  const filteredKeys: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (matchesEnvPattern(key, patterns)) {
      filtered[key] = value;
    } else {
      filteredKeys.push(key);
    }
  }

  return { filtered, filteredKeys };
}

/**
 * Gets environment variables from parent process, excluding dangerous ones
 * @returns Safe environment variables from parent process
 */
function getParentEnvironment(): Record<string, string> {
  const parentEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    // Skip bash functions and other potentially dangerous variables
    if (value.startsWith('()')) {
      logger.debug(`Skipping dangerous environment variable: ${key}`);
      continue;
    }

    parentEnv[key] = value;
  }

  return parentEnv;
}

/**
 * Substitutes environment variables in configuration values
 * @param configValue Configuration value that may contain ${VAR} patterns
 * @returns Value with environment variables substituted
 */
export function substituteEnvVars(configValue: string): string {
  return configValue.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
    const value = process.env[envVar.trim()];
    if (value === undefined) {
      logger.warn(`Environment variable ${envVar} not found, keeping placeholder: ${match}`);
      return match;
    }
    return value;
  });
}

/**
 * Recursively substitutes environment variables in a configuration object
 * @param config Configuration object
 * @returns Configuration object with environment variables substituted
 */
export function substituteEnvVarsInConfig(config: any): any {
  if (typeof config === 'string') {
    return substituteEnvVars(config);
  }

  if (Array.isArray(config)) {
    return config.map((item) => substituteEnvVarsInConfig(item));
  }

  if (config && typeof config === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(config)) {
      result[key] = substituteEnvVarsInConfig(value);
    }
    return result;
  }

  return config;
}

/**
 * Processes environment configuration for stdio transport
 * @param config Environment processing configuration
 * @returns Processed environment variables with metadata
 */
export function processEnvironment(config: EnvProcessingConfig): ProcessedEnvironment {
  // 1. Start with SDK safe defaults
  const sdkDefaults = getDefaultEnvironment();
  const sdkDefaultKeys = Object.keys(sdkDefaults);

  logger.debug(`SDK default environment variables: ${sdkDefaultKeys.join(', ')}`);

  // 2. Optionally inherit from parent process
  let inheritedEnv: Record<string, string> = {};
  let inheritedKeys: string[] = [];

  if (config.inheritParentEnv) {
    const parentEnv = getParentEnvironment();
    inheritedEnv = { ...parentEnv };
    inheritedKeys = Object.keys(parentEnv).filter((key) => !sdkDefaultKeys.includes(key));
    logger.debug(`Inheriting ${inheritedKeys.length} additional environment variables from parent`);
  }

  // 3. Combine SDK defaults and inherited environment
  let combinedEnv = { ...sdkDefaults, ...inheritedEnv };

  // 4. Apply pattern filtering if specified
  let filteredKeys: string[] = [];
  if (config.envFilter && config.envFilter.length > 0) {
    const filterResult = applyEnvPatterns(combinedEnv, config.envFilter);
    combinedEnv = filterResult.filtered;
    filteredKeys = filterResult.filteredKeys;
    logger.debug(`Environment filtering removed ${filteredKeys.length} variables: ${filteredKeys.join(', ')}`);
  }

  // 5. Add custom environment variables
  let customEnv: Record<string, string> = {};
  let customKeys: string[] = [];

  if (config.env) {
    if (Array.isArray(config.env)) {
      customEnv = parseEnvArray(config.env);
    } else {
      customEnv = { ...config.env };
    }

    // Apply environment variable substitution to custom env
    for (const [key, value] of Object.entries(customEnv)) {
      customEnv[key] = substituteEnvVars(value);
    }

    customKeys = Object.keys(customEnv);
    logger.debug(`Adding ${customKeys.length} custom environment variables: ${customKeys.join(', ')}`);
  }

  // 6. Final merge (custom env overrides everything)
  const processedEnv = { ...combinedEnv, ...customEnv };

  const result: ProcessedEnvironment = {
    processedEnv,
    sources: {
      sdkDefaults: sdkDefaultKeys,
      inherited: inheritedKeys,
      custom: customKeys,
      filtered: filteredKeys,
    },
  };

  logger.debug(`Environment processing complete. Total variables: ${Object.keys(processedEnv).length}`);
  return result;
}
