import fs from 'fs';
import path from 'path';

import logger from '@src/logger/logger.js';

/**
 * Server information stored in PID file
 */
export interface ServerPidInfo {
  pid: number;
  url: string;
  port: number;
  host: string;
  transport: 'http';
  startedAt: string;
  configDir: string;
}

const PID_FILE_NAME = 'server.pid';

// Track registered handlers to prevent multiple registrations
let cleanupRegistered = false;
let signalHandlersRegistered = false;

/**
 * Reset handler registration flags (for testing purposes only)
 * @internal
 */
export function _resetHandlerFlags(): void {
  cleanupRegistered = false;
  signalHandlersRegistered = false;
}

/**
 * Get PID file path for a given config directory
 */
export function getPidFilePath(configDir: string): string {
  return path.join(configDir, PID_FILE_NAME);
}

/**
 * Check if a process is alive
 * @param pid Process ID to check
 * @returns true if process is alive, false otherwise
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Send signal 0 (no-op) to check if process exists
    // This doesn't actually send a signal, just checks permissions
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // ESRCH = process doesn't exist
    // EPERM = process exists but no permission (still alive)
    return err instanceof Error && 'code' in err && (err as { code: string }).code === 'EPERM';
  }
}

/**
 * Write PID file with server information
 * @param configDir Configuration directory
 * @param serverInfo Server information to write
 */
export function writePidFile(configDir: string, serverInfo: ServerPidInfo): void {
  const pidFilePath = getPidFilePath(configDir);

  try {
    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write PID file atomically
    const content = JSON.stringify(serverInfo, null, 2);
    fs.writeFileSync(pidFilePath, content, { encoding: 'utf-8' });

    logger.info(`PID file written: ${pidFilePath}`);
  } catch (error) {
    logger.error(`Failed to write PID file: ${error}`);
    throw error;
  }
}

/**
 * Read PID file and validate process is alive
 * @param configDir Configuration directory
 * @returns Server info if valid, null if file doesn't exist or process is dead
 */
export function readPidFile(configDir: string): ServerPidInfo | null {
  const pidFilePath = getPidFilePath(configDir);

  try {
    if (!fs.existsSync(pidFilePath)) {
      return null;
    }

    const content = fs.readFileSync(pidFilePath, 'utf-8');
    const serverInfo: ServerPidInfo = JSON.parse(content) as ServerPidInfo;

    // Validate required fields
    if (!serverInfo.pid || !serverInfo.url || !serverInfo.port) {
      logger.warn(`Invalid PID file format: ${pidFilePath}`);
      return null;
    }

    // Check if process is still alive
    if (!isProcessAlive(serverInfo.pid)) {
      logger.warn(`PID file points to dead process (PID: ${serverInfo.pid})`);
      return null;
    }

    return serverInfo;
  } catch (error) {
    logger.error(`Failed to read PID file: ${error}`);
    return null;
  }
}

/**
 * Cleanup (delete) PID file
 * @param configDir Configuration directory
 */
export function cleanupPidFile(configDir: string): void {
  const pidFilePath = getPidFilePath(configDir);

  try {
    if (fs.existsSync(pidFilePath)) {
      fs.unlinkSync(pidFilePath);
      logger.info(`PID file cleaned up: ${pidFilePath}`);
    }
  } catch (error) {
    logger.error(`Failed to cleanup PID file: ${error}`);
  }
}

/**
 * Cleanup function to remove PID file
 * @param configDir Configuration directory
 */
export function cleanupPidFileOnExit(configDir: string): void {
  cleanupPidFile(configDir);
}

/**
 * Register cleanup handler to remove PID file on process exit (only the 'exit' event)
 * This function only registers for the 'exit' event, not signal handlers.
 * Signal handlers should be managed by the main application to ensure proper cleanup order.
 * @param configDir Configuration directory
 */
export function registerPidFileCleanup(configDir: string): void {
  // Prevent multiple registrations
  if (cleanupRegistered) {
    return;
  }

  const cleanup = () => {
    cleanupPidFile(configDir);
  };

  // Only register for the 'exit' event
  // Signal handlers (SIGINT, SIGTERM, SIGHUP) should be managed by the main application
  process.on('exit', cleanup);
  cleanupRegistered = true;
}

/**
 * Register signal handlers with cleanup function (for standalone usage)
 * Only use this if the application doesn't have its own signal handlers
 * @param configDir Configuration directory
 */
export function registerPidFileSignalHandlers(configDir: string): void {
  // Prevent multiple registrations
  if (signalHandlersRegistered) {
    return;
  }

  const cleanup = () => {
    cleanupPidFile(configDir);
  };

  // Register cleanup for signal handlers
  // NOTE: This should only be used if the main application doesn't have its own signal handlers
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const signal of signals) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
  signalHandlersRegistered = true;
}
