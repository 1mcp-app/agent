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
 * Register cleanup handlers to remove PID file on process exit
 * @param configDir Configuration directory
 */
export function registerPidFileCleanup(configDir: string): void {
  const cleanup = () => {
    cleanupPidFile(configDir);
  };

  // Register cleanup for various exit scenarios
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGHUP', () => {
    cleanup();
    process.exit(0);
  });
}
