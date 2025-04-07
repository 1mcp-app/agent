import winston from 'winston';
import { MCPTransport } from './mcpTransport.js';
import { ServerInfo } from '../types.js';

// Map MCP log levels to Winston log levels
const MCP_TO_WINSTON_LEVEL: Record<string, string> = {
  debug: 'debug',
  info: 'info',
  notice: 'info',
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
  level: 'info',
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
 * Creates and adds an MCP transport to the logger
 * @param serverInfo The server info instance
 * @param loggerName Optional name for the logger in MCP notifications
 */
export function addMCPTransport(serverInfo: ServerInfo, loggerName?: string): void {
  // Create a new MCP transport for this server
  const transport = new MCPTransport({
    server: serverInfo.server,
    loggerName: loggerName || '1mcp',
    level: 'info',
  });

  // Add to winston logger
  logger.add(transport);

  // Store in server info
  serverInfo.mcpTransport = transport;
}

/**
 * Removes the MCP transport from the logger if it exists
 * @param serverInfo The server info instance
 */
export function removeMCPTransport(serverInfo: ServerInfo): void {
  const transport = serverInfo.mcpTransport;
  if (transport) {
    logger.remove(transport);
    serverInfo.mcpTransport = undefined;
  }
}

/**
 * Enable the console transport
 */
export function enableConsoleTransport(): void {
  if (logger.transports.length > 0) {
    logger.transports[0].silent = false;
  }
}

/**
 * Set the connection status of the MCP transport
 * @param serverInfo The server info instance
 * @param connected Whether the server is connected
 */
export function setMCPTransportConnected(serverInfo: ServerInfo, connected: boolean): void {
  const transport = serverInfo.mcpTransport;
  if (transport) {
    if (connected) {
      transport.setConnected(connected);
    } else {
      transport.setConnected(connected);
      removeMCPTransport(serverInfo);
    }
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

export default logger;
