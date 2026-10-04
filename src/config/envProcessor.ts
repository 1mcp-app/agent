import logger, { debugIf } from '@src/logger/logger.js';

import { getRuntimeParentEnvironment } from './runtimeBootstrap.js';

const DEFAULT_INHERITED_ENV_VARS =
  process.platform === 'win32'
    ? [
        'APPDATA',
        'HOMEDRIVE',
        'HOMEPATH',
        'LOCALAPPDATA',
        'PATH',
        'PROCESSOR_ARCHITECTURE',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'USERNAME',
        'USERPROFILE',
        'PROGRAMFILES',
      ]
    : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'];

function getDefaultEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = getRuntimeParentEnvironment()[key];
    if (value !== undefined && !value.startsWith('()')) {
      environment[key] = value;
    }
  }
  return environment;
}

/**
 * Configuration for environment processing
 */
export interface EnvProcessingConfig {
  readonly inheritParentEnv?: boolean;
  readonly envFilter?: string[];
  readonly env?: Record<string, string> | string[];
  readonly substituteEnv?: boolean;
  readonly runtimeEnv?: Readonly<Record<string, string>>;
}

/**
 * Generic configuration object type for environment variable substitution
 */
export interface ConfigObject {
  [key: string]: unknown;
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
export function parseEnvArray(
  envArray: string[],
  sourceEnv: Readonly<Record<string, string | undefined>> = getRuntimeParentEnvironment(),
): Record<string, string> {
  const envObject: Record<string, string> = {};

  for (const entry of envArray) {
    const equalIndex = entry.indexOf('=');
    if (equalIndex === -1) {
      // No equals sign, treat as inheritance key
      const key = entry.trim();
      const envValue = sourceEnv[key];
      if (envValue !== undefined) {
        envObject[key] = envValue;
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
function getParentEnvironment(runtimeEnv: Readonly<Record<string, string>> = {}): Record<string, string> {
  const parentEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries({ ...runtimeEnv, ...getRuntimeParentEnvironment() })) {
    if (value === undefined) continue;

    // Skip bash functions and other potentially dangerous variables
    if (value.startsWith('()')) {
      debugIf(() => ({ message: 'envProcessor.skipping.dangerous.environment.variable.62436294' }));
      continue;
    }

    parentEnv[key] = value;
  }

  return parentEnv;
}

/**
 * Substitutes environment variables in configuration values
 * @param configValue Configuration value that may contain ${VAR} or $VAR patterns
 * @returns Value with environment variables substituted
 */
export function substituteEnvVars(
  configValue: string,
  env: Record<string, string | undefined> = getRuntimeParentEnvironment(),
): string {
  return configValue.replace(
    /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, bracedEnvVar?: string, shellEnvVar?: string) => {
      const envVar = bracedEnvVar ?? shellEnvVar;
      const envVarName = envVar?.trim() ?? '';
      const envValue = env[envVarName];
      if (envValue === undefined) {
        logger.warn('envProcessor.environment.variable.not.found.keeping.placeholder.unchanged.9e4fa714');
        return match;
      }
      return envValue;
    },
  );
}

/**
 * Processes environment configuration for stdio transport
 * @param config Environment processing configuration
 * @returns Processed environment variables with metadata
 */
export function processEnvironment(config: EnvProcessingConfig): ProcessedEnvironment {
  const referenceEnvironment = { ...config.runtimeEnv, ...getRuntimeParentEnvironment() };
  // 1. Start with SDK safe defaults
  const sdkDefaults = getDefaultEnvironment();
  const sdkDefaultKeys = Object.keys(sdkDefaults);

  debugIf(() => ({ message: 'envProcessor.sdk.default.environment.variables.0a428954' }));

  // 2. Optionally inherit from parent process
  let inheritedEnv: Record<string, string> = {};
  let inheritedKeys: string[] = [];

  if (config.inheritParentEnv) {
    const parentEnv = getParentEnvironment(config.runtimeEnv);
    inheritedEnv = { ...parentEnv };
    inheritedKeys = Object.keys(parentEnv).filter((key) => !sdkDefaultKeys.includes(key));
    debugIf(() => ({ message: 'envProcessor.inheriting.additional.environment.variables.from.parent.fec3533f' }));
  }

  // 3. Combine SDK defaults and inherited environment
  let combinedEnv = { ...sdkDefaults, ...inheritedEnv };

  // 4. Apply pattern filtering if specified
  let filteredKeys: string[] = [];
  if (config.envFilter && config.envFilter.length > 0) {
    const filterResult = applyEnvPatterns(combinedEnv, config.envFilter);
    combinedEnv = filterResult.filtered;
    filteredKeys = filterResult.filteredKeys;
    debugIf(() => ({ message: 'envProcessor.environment.filtering.removed.variables.43fe7eba' }));
  }

  // 5. Add custom environment variables
  let customEnv: Record<string, string> = {};
  let customKeys: string[] = [];

  if (config.env) {
    if (Array.isArray(config.env)) {
      customEnv = parseEnvArray(config.env, referenceEnvironment);
    } else {
      customEnv = { ...config.env };
    }

    // Apply environment variable substitution to custom env.
    if (config.substituteEnv !== false) {
      const substitutionEnv = { ...combinedEnv, ...referenceEnvironment, ...customEnv };

      for (const key of Object.keys(customEnv)) {
        const value = customEnv[key];
        if (typeof value === 'string') {
          const sourceValue = referenceEnvironment[key] ?? combinedEnv[key];
          if (sourceValue === undefined) {
            delete substitutionEnv[key];
          } else {
            substitutionEnv[key] = sourceValue;
          }
          customEnv[key] = substituteEnvVars(value, substitutionEnv);
          substitutionEnv[key] = customEnv[key];
        }
      }
    }

    customKeys = Object.keys(customEnv);
    debugIf(() => ({ message: 'envProcessor.adding.custom.environment.variables.ff9cbb4f' }));
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

  debugIf(() => ({ message: 'envProcessor.environment.processing.complete.total.variables.aaf53195' }));
  return result;
}
