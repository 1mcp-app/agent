/**
 * Logging configuration resolution.
 *
 * Resolves the effective logging settings from all sources in a single place so
 * the precedence order is explicit and testable, independent of how each source
 * is wired in. Precedence, highest to lowest:
 *
 *   CLI flag > structured `logging.*` > deprecated flat alias (`logLevel`/`logFile`) > environment variable > default
 *
 * Rotation (`maxSize`/`maxFiles`) is intentionally only sourced from the
 * structured `logging` block — the deprecated flat keys never supported it.
 */

export const DEFAULT_LOG_LEVEL = 'info';

export interface ResolvedLoggingConfig {
  level: string;
  file?: string;
  /** Rotation threshold in bytes (parsed from number or size string). */
  maxSize?: number;
  /** Max rotated files to retain. */
  maxFiles?: number;
}

export interface LoggingResolution {
  resolved: ResolvedLoggingConfig;
  /**
   * Names of deprecated flat config keys that were present in config
   * (`logLevel`/`logFile`). Callers use this to emit a one-time notice.
   */
  deprecatedKeys: string[];
}

export interface LoggingSources {
  /** Explicit CLI flags (`--log-level`/`--log-file`). Highest priority. */
  cli?: { level?: string; file?: string };
  /** Structured `logging` block from config. */
  structured?: { level?: string; file?: string; maxSize?: number | string; maxFiles?: number };
  /** Deprecated flat config keys (`logLevel`/`logFile`). */
  flat?: { level?: string; file?: string };
  /** Environment-variable fallback (e.g. legacy `LOG_LEVEL`). */
  env?: { level?: string; file?: string };
}

/**
 * Parse a byte size from a number (bytes) or a string with an optional unit
 * suffix (`k`/`m`/`g`, case-insensitive, optional trailing `b`). Returns
 * undefined for missing, non-positive, or unparseable values.
 *
 * Examples: `1048576` → 1048576, `"10m"` → 10485760, `"1g"` → 1073741824.
 */
export function parseByteSize(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i);
  if (!match) {
    return undefined;
  }

  const amount = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase();
  const multiplier = unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1;
  const bytes = Math.floor(amount * multiplier);
  return bytes > 0 ? bytes : undefined;
}

/**
 * Resolve effective logging configuration from all sources by precedence.
 */
export function resolveLoggingConfig(sources: LoggingSources): LoggingResolution {
  const { cli = {}, structured = {}, flat = {}, env = {} } = sources;

  const deprecatedKeys: string[] = [];
  if (flat.level !== undefined) {
    deprecatedKeys.push('logLevel');
  }
  if (flat.file !== undefined) {
    deprecatedKeys.push('logFile');
  }

  const level = cli.level ?? structured.level ?? flat.level ?? env.level ?? DEFAULT_LOG_LEVEL;
  const file = cli.file ?? structured.file ?? flat.file ?? env.file;
  const maxSize = parseByteSize(structured.maxSize);
  const maxFiles = structured.maxFiles;

  return {
    resolved: { level, file, maxSize, maxFiles },
    deprecatedKeys,
  };
}
