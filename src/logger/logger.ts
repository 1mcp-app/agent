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
    return `${timestamp} [${level.toUpperCase()}] message=${JSON.stringify(message)}${metaStr}`;
  }),
);

// Create the logger without the MCP transport initially
const logger = winston.createLogger({
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
  if (logger.transports.length > 0) {
    logger.transports[0].silent = false;
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
  logger.level = winstonLevel;
  logger.transports.forEach((transport) => {
    transport.level = winstonLevel;
  });
}

/**
 * Configure logger with CLI options and transport awareness
 * @param options Configuration options for the logger
 */
export function configureLogger(options: { logLevel?: string; logFile?: string; transport?: string }): void {
  // Determine log level priority: CLI > ONE_MCP_LOG_LEVEL > LOG_LEVEL (deprecated)
  let logLevel = options.logLevel;

  if (!logLevel) {
    logLevel = process.env.ONE_MCP_LOG_LEVEL;
  }

  if (!logLevel) {
    logLevel = process.env.LOG_LEVEL;
    if (logLevel) {
      logger.warn(
        'LOG_LEVEL environment variable is deprecated. Please use ONE_MCP_LOG_LEVEL or --log-level CLI option instead.',
      );
    }
  }

  logLevel = logLevel || 'info';

  // Convert MCP log level to Winston log level
  const winstonLevel = MCP_TO_WINSTON_LEVEL[logLevel] || 'info';

  // Clear existing transports
  logger.clear();

  // Set logger level
  logger.level = winstonLevel;

  // Configure transports based on options
  if (options.logFile) {
    // Add file transport
    logger.add(
      new winston.transports.File({
        filename: options.logFile,
        format: customFormat,
        level: winstonLevel,
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
  return logger.isDebugEnabled();
}

/**
 * Check if info logging is enabled
 * Use this to avoid expensive operations when info logging is disabled
 */
export function isInfoEnabled(): boolean {
  return logger.isInfoEnabled();
}

/**
 * Check if warn logging is enabled
 * Use this to avoid expensive operations when warn logging is disabled
 */
export function isWarnEnabled(): boolean {
  return logger.isWarnEnabled();
}

/**
 * Conditional debug logging - only executes the message function if debug is enabled
 * @param messageOrFunc Message string or function that returns message and metadata
 */
export function debugIf(messageOrFunc: string | (() => { message: string; meta?: any })): void {
  if (isDebugEnabled()) {
    if (typeof messageOrFunc === 'string') {
      logger.debug(messageOrFunc);
    } else {
      try {
        const result = messageOrFunc();
        if (result && typeof result === 'object' && 'message' in result) {
          const { message, meta } = result;
          if (meta) {
            logger.debug(message, meta);
          } else {
            logger.debug(message);
          }
        } else {
          // Fallback for malformed callback results
          logger.debug('[debugIf: Invalid callback result]', { callbackResult: result });
        }
      } catch (error) {
        // Never let logging errors crash the application
        // Use logger.warn to avoid infinite recursion if debugIf were to call itself
        if (logger.isWarnEnabled()) {
          logger.warn('debugIf callback failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }
    }
  }
}

/**
 * Conditional info logging - only executes the message function if info is enabled
 * @param messageOrFunc Message string or function that returns message and metadata
 */
export function infoIf(messageOrFunc: string | (() => { message: string; meta?: any })): void {
  if (isInfoEnabled()) {
    if (typeof messageOrFunc === 'string') {
      logger.info(messageOrFunc);
    } else {
      try {
        const result = messageOrFunc();
        if (result && typeof result === 'object' && 'message' in result) {
          const { message, meta } = result;
          if (meta) {
            logger.info(message, meta);
          } else {
            logger.info(message);
          }
        } else {
          // Fallback for malformed callback results
          logger.info('[infoIf: Invalid callback result]', { callbackResult: result });
        }
      } catch (error) {
        // Never let logging errors crash the application
        // Use logger.warn to avoid infinite recursion if infoIf were to call itself
        if (logger.isWarnEnabled()) {
          logger.warn('infoIf callback failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }
    }
  }
}

/**
 * Conditional warn logging - only executes the message function if warn is enabled
 * @param messageOrFunc Message string or function that returns message and metadata
 */
export function warnIf(messageOrFunc: string | (() => { message: string; meta?: any })): void {
  if (isWarnEnabled()) {
    if (typeof messageOrFunc === 'string') {
      logger.warn(messageOrFunc);
    } else {
      try {
        const result = messageOrFunc();
        if (result && typeof result === 'object' && 'message' in result) {
          const { message, meta } = result;
          if (meta) {
            logger.warn(message, meta);
          } else {
            logger.warn(message);
          }
        } else {
          // Fallback for malformed callback results
          logger.warn('[warnIf: Invalid callback result]', { callbackResult: result });
        }
      } catch (error) {
        // Never let logging errors crash the application
        // For warnIf, we use console.error as last resort to avoid recursion
        console.error('warnIf callback failed:', error instanceof Error ? error.message : String(error));
      }
    }
  }
}

export default logger;
