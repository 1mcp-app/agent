import { isBackendDiagnosticEntry } from '@src/domains/backend-logs/backendLogBroker.js';
import { sanitizeBackendLogContent } from '@src/domains/backend-logs/backendLogSanitizer.js';
import type { BackendLogEntry } from '@src/domains/backend-logs/backendLogTypes.js';
import { type EventFields, normalizeEvent } from '@src/observability/events/normalize.js';
import { EVENT_REGISTRY, type EventName } from '@src/observability/events/registry.js';
import { ownData } from '@src/observability/privacy/fields.js';
import { ManagedStdioStderrEvent } from '@src/transport/managedStdioStderrEvent.js';
import type { ManagedStdioStderrMetadata } from '@src/transport/managedStdioStderrMetadata.js';

import chalk from 'chalk';
import winston from 'winston';

// Map MCP log levels to Winston log levels
const MCP_TO_WINSTON_LEVEL: Record<string, string> = {
  debug: 'debug',
  info: 'info',
  notice: 'info',
  warn: 'warn', // Support both 'warn' and 'warning' for user convenience
  warning: 'warn',
  error: 'error',
  critical: 'error',
  alert: 'error',
  emergency: 'error',
};

// Color mapping for log levels
const LEVEL_COLORS: Record<string, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
};

// Custom format for console and file output
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }),
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const keys = Object.keys(meta);
    const metaStr = keys.length > 0 ? ` ${keys.map((key) => `${key}=${JSON.stringify(meta[key])}`).join(' ')}` : '';

    // Colorize timestamp and level
    const colorizedTimestamp = chalk.gray(timestamp);
    const colorFn = LEVEL_COLORS[level] || ((text: string) => text);
    const colorizedLevel = colorFn(`[${level.toUpperCase()}]`);

    return `${colorizedTimestamp} ${colorizedLevel} message=${JSON.stringify(message)}${metaStr}`;
  }),
);

// Create the logger without the MCP transport initially
const sink = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  transports: [
    // Add a silent transport by default to prevent "no transports" warnings
    new winston.transports.Console({
      silent: true,
      format: consoleFormat,
    }),
  ],
  // Prevent logger from exiting on error
  exitOnError: false,
});

/**
 * Enable the console transport
 */
export function enableConsoleTransport(): void {
  if (sink.transports.length > 0) {
    sink.transports[0].silent = false;
  }
}

/**
 * Set the log level for the logger
 * @param mcpLevel The MCP log level to set
 */
export function setLogLevel(mcpLevel: string): void {
  // Convert MCP log level to Winston log level
  const winstonLevel = MCP_TO_WINSTON_LEVEL[mcpLevel] || 'info';

  // Set the log level for all transports
  sink.level = winstonLevel;
  sink.transports.forEach((transport) => {
    transport.level = winstonLevel;
  });
}

/**
 * Configuration options for the logger
 */
export interface LoggerOptions {
  logLevel?: string;
  logFile?: string;
  transport?: string;
  /** Max size in bytes before the file transport rotates. Enables rotation. */
  maxSize?: number;
  /** Max number of rotated files to retain (used with maxSize). */
  maxFiles?: number;
}

/**
 * Configure logger with CLI options and transport awareness
 * @param options Configuration options for the logger
 */
export function configureLogger(options: LoggerOptions): void {
  // Determine log level priority: CLI > ONE_MCP_LOG_LEVEL > LOG_LEVEL (deprecated)
  let logLevel = options.logLevel;

  if (!logLevel) {
    logLevel = process.env.ONE_MCP_LOG_LEVEL;
  }

  if (!logLevel) {
    logLevel = process.env.LOG_LEVEL;
    if (logLevel) {
      logger.warn('logger.deprecated-level');
    }
  }

  logLevel = logLevel || 'info';

  // Convert MCP log level to Winston log level
  const winstonLevel = MCP_TO_WINSTON_LEVEL[logLevel] || 'info';

  // Clear existing transports
  logger.clear();

  // Set logger level
  sink.level = winstonLevel;

  // Configure transports based on options
  if (options.logFile) {
    // Add file transport, with native size-based rotation when configured.
    // Winston's File transport rotates in place when `maxsize` is set, keeping
    // up to `maxFiles` rotated files — no extra dependency required.
    logger.add(
      new winston.transports.File({
        filename: options.logFile,
        format: customFormat,
        level: winstonLevel,
        ...(options.maxSize ? { maxsize: options.maxSize } : {}),
        ...(options.maxFiles ? { maxFiles: options.maxFiles } : {}),
      }),
    );

    // Add console transport except for stdio transport (backward compatibility for serve)
    if (options.transport !== 'stdio') {
      logger.add(
        new winston.transports.Console({
          format: consoleFormat,
          level: winstonLevel,
        }),
      );
    }
  } else {
    // Add console transport (default behavior)
    // For stdio transport in serve command, suppress console output to avoid interfering with MCP protocol
    const shouldSilence = options.transport === 'stdio';
    logger.add(
      new winston.transports.Console({
        format: consoleFormat,
        level: winstonLevel,
        silent: shouldSilence,
      }),
    );
  }
}

/**
 * Check if debug logging is enabled
 * Use this to avoid expensive operations when debug logging is disabled
 */
export function isDebugEnabled(): boolean {
  return sink.isDebugEnabled();
}

/**
 * Check if info logging is enabled
 * Use this to avoid expensive operations when info logging is disabled
 */
export function isInfoEnabled(): boolean {
  return sink.isInfoEnabled();
}

/**
 * Check if warn logging is enabled
 * Use this to avoid expensive operations when warn logging is disabled
 */
export function isWarnEnabled(): boolean {
  return sink.isWarnEnabled();
}

/** Typed runtime logger. Raw Winston transports are kept inside this module. */
function emit<E extends EventName>(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: E,
  fields?: EventFields<E>,
): void {
  const normalized = normalizeEvent(event, fields);
  if (normalized) sink.log({ ...normalized, level });
}

const logger = {
  debug: <E extends EventName>(event: E, fields?: EventFields<E>) => emit('debug', event, fields),
  info: <E extends EventName>(event: E, fields?: EventFields<E>) => emit('info', event, fields),
  warn: <E extends EventName>(event: E, fields?: EventFields<E>) => emit('warn', event, fields),
  error: <E extends EventName>(event: E, fields?: EventFields<E>) => emit('error', event, fields),
  isDebugEnabled: () => sink.isDebugEnabled(),
  isInfoEnabled: () => sink.isInfoEnabled(),
  isWarnEnabled: () => sink.isWarnEnabled(),
  isErrorEnabled: () => sink.isErrorEnabled(),
  get level() {
    return sink.level;
  },
  set level(value: string) {
    sink.level = value;
  },
  get transports() {
    return sink.transports;
  },
  clear: () => {
    sink.clear();
  },
  add: (transport: Parameters<typeof sink.add>[0]) => {
    sink.add(transport);
  },
};

interface LazyEvent<E extends EventName> {
  message: E;
  meta?: EventFields<E>;
}
function conditional<E extends EventName>(
  level: 'debug' | 'info' | 'warn' | 'error',
  input: E | (() => LazyEvent<E>),
): void {
  if (!sink.isLevelEnabled(level)) return;
  try {
    if (typeof input === 'string') {
      logger[level](input);
      return;
    }
    const result = input();
    if (!result || typeof result !== 'object') {
      logger.warn('logger.callback-invalid');
      return;
    }
    const event = ownData(result, 'message');
    const fields = ownData(result, 'meta');
    if (typeof event !== 'string' || !Object.hasOwn(EVENT_REGISTRY, event)) {
      logger.warn('logger.callback-invalid');
      return;
    }
    logger[level](event as E, fields as EventFields<E>);
  } catch (error) {
    logger.warn('logger.callback-failed', { error });
  }
}
export function debugIf<E extends EventName>(input: E | (() => LazyEvent<E>)): void {
  conditional('debug', input);
}
export function infoIf<E extends EventName>(input: E | (() => LazyEvent<E>)): void {
  conditional('info', input);
}
export function warnIf<E extends EventName>(input: E | (() => LazyEvent<E>)): void {
  conditional('warn', input);
}
export function errorIf<E extends EventName>(input: E | (() => LazyEvent<E>)): void {
  conditional('error', input);
}
export function isErrorEnabled(): boolean {
  return sink.isErrorEnabled();
}

/** ADR 0011 local diagnostic projection. Never normalize or correlate backend records. */
export function writeBackendDiagnostic(entry: BackendLogEntry): void {
  if (!isBackendDiagnosticEntry(entry)) return;
  sink.warn(`[${entry.displayName}] ${entry.content}`, {
    serverName: entry.canonicalName,
    source: 'backend-stderr',
    backendLogSequence: entry.sequence,
    backendLogSourceId: entry.sourceId,
    backendLogEventKind: entry.kind,
    ...(entry.count === undefined ? {} : { count: entry.count }),
    ...(entry.truncated ? { truncated: true } : {}),
  });
}

/** Legacy managed-stderr fallback is also a diagnostic-only local sink. */
export function writeManagedStderrDiagnostic(
  event: ManagedStdioStderrEvent,
  metadata: ManagedStdioStderrMetadata,
): void {
  if (
    ![ManagedStdioStderrEvent.Line, ManagedStdioStderrEvent.Repeated, ManagedStdioStderrEvent.Suppressed].includes(
      event,
    )
  )
    return;
  const line = typeof metadata.line === 'string' ? sanitizeBackendLogContent(metadata.line) : '';
  sink.warn(event, {
    source: 'backend-stderr',
    serverName: sanitizeBackendLogContent(metadata.serverName),
    ...(line ? { line } : {}),
    ...(metadata.repeatCount === undefined ? {} : { repeatCount: metadata.repeatCount }),
    ...(metadata.suppressedCount === undefined ? {} : { suppressedCount: metadata.suppressedCount }),
    ...(metadata.truncated ? { truncated: true } : {}),
  });
}

export default logger;
