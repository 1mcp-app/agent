import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getAppBackupDir, getGlobalBackupDir } from '@src/constants.js';

interface ErrnoException extends Error {
  code?: string;
  errno?: number;
  path?: string;
  syscall?: string;
}

/**
 * Type guard to check if an error is an ErrnoException with a specific code
 */
function isErrnoExceptionWithCode(error: unknown, code: string): error is ErrnoException & { code: string } {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code === code;
}

/**
 * Type guard to validate if an object conforms to BackupInfo structure
 */
function isValidBackupInfo(obj: unknown): obj is BackupInfo {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const backup = obj as Record<string, unknown>;

  return Boolean(
    typeof backup.originalPath === 'string' &&
      typeof backup.backupPath === 'string' &&
      typeof backup.timestamp === 'number' &&
      typeof backup.checksum === 'string' &&
      backup.metadata &&
      typeof backup.metadata === 'object' &&
      typeof (backup.metadata as Record<string, unknown>).app === 'string' &&
      typeof (backup.metadata as Record<string, unknown>).operation === 'string' &&
      typeof (backup.metadata as Record<string, unknown>).version === 'string' &&
      typeof (backup.metadata as Record<string, unknown>).serverCount === 'number' &&
      typeof (backup.metadata as Record<string, unknown>).fileSize === 'number',
  );
}

/**
 * Safely parse JSON and validate as BackupInfo
 */
function parseBackupInfo(jsonContent: string): BackupInfo {
  try {
    const parsed = JSON.parse(jsonContent) as unknown;
    if (!isValidBackupInfo(parsed)) {
      throw new Error('Invalid backup metadata structure');
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON in backup metadata');
    }
    throw error;
  }
}

/**
 * Backup and recovery system for app configuration consolidation.
 *
 * Provides safe backup creation, metadata tracking, and rollback
 * capabilities for configuration operations.
 */

export interface BackupInfo {
  originalPath: string;
  backupPath: string;
  timestamp: number;
  checksum: string;
  metadata: {
    app: string;
    operation: string;
    version: string;
    serverCount: number;
    fileSize: number;
  };
}

export interface BackupListItem {
  app: string;
  backupPath: string;
  metaPath: string;
  timestamp: number;
  operation: string;
  serverCount: number;
  age: string;
}

/**
 * Create a backup of configuration file with metadata
 */
export function createBackup(configPath: string, app: string, operation: string, serverCount: number = 0): BackupInfo {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file does not exist: ${configPath}`);
  }

  const timestamp = Date.now();
  const dateStr = new Date(timestamp).toISOString().replace(/[:.-]/g, '').slice(0, 15); // YYYYMMDDTHHMMSS

  // Create app-specific backup directory
  const appBackupDir = getAppBackupDir(app);
  fs.mkdirSync(appBackupDir, { recursive: true });

  // Use descriptive filename in centralized location
  const backupFileName = `${dateStr}_${operation}.backup`;
  const backupPath = path.join(appBackupDir, backupFileName);

  const content = fs.readFileSync(configPath, 'utf8');
  const checksum = crypto.createHash('sha256').update(content).digest('hex');
  const stats = fs.statSync(configPath);

  // Create backup file
  fs.copyFileSync(configPath, backupPath);

  const backupInfo: BackupInfo = {
    originalPath: configPath,
    backupPath,
    timestamp,
    checksum,
    metadata: {
      app,
      operation,
      version: process.env.npm_package_version || 'unknown',
      serverCount,
      fileSize: stats.size,
    },
  };

  // Store backup metadata
  const metaPath = `${backupPath}.meta`;
  fs.writeFileSync(metaPath, JSON.stringify(backupInfo, null, 2));

  return backupInfo;
}

/**
 * Rollback from backup file
 */
export async function rollbackFromBackup(backup: BackupInfo): Promise<void> {
  if (!fs.existsSync(backup.backupPath)) {
    throw new Error(`Backup file not found: ${backup.backupPath}`);
  }

  // Verify backup integrity
  const backupContent = fs.readFileSync(backup.backupPath, 'utf8');
  const currentChecksum = crypto.createHash('sha256').update(backupContent).digest('hex');

  if (currentChecksum !== backup.checksum) {
    throw new Error('Backup file integrity check failed - checksum mismatch');
  }

  // Restore original file
  fs.copyFileSync(backup.backupPath, backup.originalPath);
}

/**
 * Rollback from backup file path
 */
export async function rollbackFromBackupPath(backupPath: string): Promise<void> {
  const metaPath = `${backupPath}.meta`;

  if (!fs.existsSync(metaPath)) {
    throw new Error(`Backup metadata not found: ${metaPath}`);
  }

  const metaContent = fs.readFileSync(metaPath, 'utf8');
  const backupInfo = parseBackupInfo(metaContent);

  await rollbackFromBackup(backupInfo);
}

/**
 * List all available backups for a specific app
 */
export function listAppBackups(app?: string): BackupListItem[] {
  const backups: BackupListItem[] = [];

  // First, check the centralized backup directory (most efficient)
  const centralBackupDir = getGlobalBackupDir();
  if (fs.existsSync(centralBackupDir)) {
    if (app) {
      // Search specific app directory
      const appBackupDir = getAppBackupDir(app);
      scanBackupsInDirectory(appBackupDir, backups, app);
    } else {
      // Search all app directories
      try {
        const appDirs = fs.readdirSync(centralBackupDir);
        for (const appDir of appDirs) {
          const appBackupPath = path.join(centralBackupDir, appDir);
          if (fs.statSync(appBackupPath).isDirectory()) {
            scanBackupsInDirectory(appBackupPath, backups);
          }
        }
      } catch (_error) {
        // Skip if can't read central directory
        // Error is intentionally ignored for graceful degradation
      }
    }
  }

  // Then check legacy locations for existing backups
  const legacyPaths = getBackupSearchPaths().slice(1); // Skip central directory (already checked)
  for (const searchPath of legacyPaths) {
    scanBackupsInDirectory(searchPath, backups, app);
  }

  // Sort by timestamp (newest first)
  backups.sort((a, b) => b.timestamp - a.timestamp);

  return backups;
}

/**
 * Scan a directory for backup files
 */
function scanBackupsInDirectory(dirPath: string, backups: BackupListItem[], filterApp?: string): void {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      if (file.endsWith('.backup.meta')) {
        const metaPath = path.join(dirPath, file);

        try {
          const metaContent = fs.readFileSync(metaPath, 'utf8');
          const backupInfo = parseBackupInfo(metaContent);

          // Filter by app if specified
          if (filterApp && backupInfo.metadata.app !== filterApp) {
            continue;
          }

          const backupPath = backupInfo.backupPath;

          // Check if backup file still exists
          if (!fs.existsSync(backupPath)) {
            continue;
          }

          backups.push({
            app: backupInfo.metadata.app,
            backupPath,
            metaPath,
            timestamp: backupInfo.timestamp,
            operation: backupInfo.metadata.operation,
            serverCount: backupInfo.metadata.serverCount,
            age: formatAge(backupInfo.timestamp),
          });
        } catch (_error) {
          // Skip invalid metadata files
          // Error is intentionally ignored for graceful degradation
          continue;
        }
      }
    }
  } catch (_error) {
    // Skip directories we can't read
    // Error is intentionally ignored for graceful degradation
    return;
  }
}

/**
 * Get search paths for backup files
 */
function getBackupSearchPaths(): string[] {
  const paths = [
    // Primary location: centralized backup directory
    getGlobalBackupDir(),
  ];

  // Legacy fallback locations for existing backups
  const homeDir = os.homedir();

  // Add current directory as fallback
  paths.push(process.cwd());

  // Add common app config directories as fallback
  if (process.platform === 'darwin') {
    paths.push(
      path.join(homeDir, 'Library/Application Support/Claude'),
      path.join(homeDir, '.cursor'),
      path.join(homeDir, '.vscode'),
    );
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    if (appData) {
      paths.push(path.join(appData, 'Claude'), path.join(homeDir, '.cursor'), path.join(homeDir, '.vscode'));
    }
  } else {
    paths.push(
      path.join(homeDir, '.config/claude'),
      path.join(homeDir, '.cursor'),
      path.join(homeDir, '.vscode'),
      path.join(homeDir, '.config/cline'),
    );
  }

  return paths.filter((p) => typeof p === 'string' && p.length > 0);
}

/**
 * Find backup by metadata file path
 */
export function findBackupByMetaPath(metaPath: string): BackupInfo | null {
  try {
    if (!fs.existsSync(metaPath)) {
      return null;
    }

    const metaContent = fs.readFileSync(metaPath, 'utf8');
    const backupInfo = parseBackupInfo(metaContent);

    // Verify backup file exists
    if (!fs.existsSync(backupInfo.backupPath)) {
      return null;
    }

    return backupInfo;
  } catch (_error) {
    return null;
  }
}

/**
 * Clean up old backups (older than specified days)
 */
export function cleanupOldBackups(maxAgeDays: number = 30): number {
  const backups = listAppBackups();
  const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let cleanedCount = 0;

  for (const backup of backups) {
    if (backup.timestamp < cutoffTime) {
      try {
        // Remove backup file
        if (fs.existsSync(backup.backupPath)) {
          fs.unlinkSync(backup.backupPath);
        }

        // Remove metadata file
        if (fs.existsSync(backup.metaPath)) {
          fs.unlinkSync(backup.metaPath);
        }

        cleanedCount++;
      } catch (_error) {
        // Skip files we can't delete
        continue;
      }
    }
  }

  return cleanedCount;
}

/**
 * Verify backup integrity
 */
export function verifyBackupIntegrity(backupInfo: BackupInfo): boolean {
  try {
    if (!fs.existsSync(backupInfo.backupPath)) {
      return false;
    }

    const content = fs.readFileSync(backupInfo.backupPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(content).digest('hex');

    return checksum === backupInfo.checksum;
  } catch (_error) {
    return false;
  }
}

/**
 * Format backup age for display
 */
function formatAge(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  }
}

/**
 * File locking mechanism for atomic operations
 */
export async function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;

  // Simple file-based locking mechanism
  let lockAcquired = false;
  const maxRetries = 10;
  const retryDelay = 100;

  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
      lockAcquired = true;
      break;
    } catch (error: unknown) {
      if (isErrnoExceptionWithCode(error, 'EEXIST')) {
        // Lock file exists, wait and retry
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!lockAcquired) {
    throw new Error(`Failed to acquire lock for ${filePath} after ${maxRetries} retries`);
  }

  try {
    const result = await operation();
    return result;
  } finally {
    // Clean up lock file
    try {
      fs.unlinkSync(lockPath);
    } catch (_error) {
      // Ignore cleanup errors
    }
  }
}
