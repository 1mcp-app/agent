import fs from 'fs';
import { randomUUID } from 'node:crypto';
import path from 'path';

import { ExpirableData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG, FILE_PREFIX_MAPPING, getGlobalConfigDir, STORAGE_SUBDIRS } from '@src/constants.js';
import logger from '@src/logger/logger.js';

import { z, type ZodType } from 'zod';

const StorageLockOwnerSchema = z.object({
  operationId: z.string().min(1),
  pid: z.number().int().positive(),
  createdAt: z.number().finite(),
});

/**
 * Generic file storage service with unified cleanup for all expirable data types.
 *
 * This service provides a common foundation for storing sessions, auth codes,
 * auth requests, and client data with automatic cleanup of expired items.
 *
 * Features:
 * - Generic CRUD operations for any expirable data type
 * - Unified periodic cleanup every 5 minutes
 * - Path traversal protection
 * - Automatic directory creation
 * - Corruption handling (removes corrupted files)
 */
export class FileStorageService {
  private storageDir: string;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(baseDir?: string, subDir?: string) {
    const configDir = baseDir || getGlobalConfigDir();
    const sessionsDir = AUTH_CONFIG.SERVER.STORAGE.DIR;

    // If subDir provided, use sessions/subDir/, otherwise just sessions/
    this.storageDir = subDir ? path.join(configDir, sessionsDir, subDir) : path.join(configDir, sessionsDir);

    this.ensureDirectory();
    this.migrateOldFilesIfNeeded();
    this.startPeriodicCleanup();
  }

  /**
   * Ensures the storage directory exists
   */
  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
        logger.info(`Created storage directory: ${this.storageDir}`);
      }
    } catch (error) {
      logger.error(`Failed to create storage directory: ${error}`);
      throw error;
    }
  }

  /**
   * Extracts UUID part from an ID by removing the prefix
   */
  private extractUuidPart(id: string, prefix: string): string {
    if (!id.startsWith(prefix)) {
      throw new Error(`Invalid ID prefix: expected ${prefix}, got ${id}`);
    }
    return id.substring(prefix.length);
  }

  /**
   * Migrates old file structure to new subdirectory structure
   * Handles two migration paths:
   * 1. Server sessions: sessions/ (flat) → sessions/server/
   * 2. Client sessions: clientSessions/ → sessions/client/
   * 3. Transport sessions: No migration (new feature)
   */
  private migrateOldFilesIfNeeded(): void {
    // Determine current subdirectory
    const currentSubDir = this.getCurrentSubDir();
    if (!currentSubDir) {
      return; // Not in subdirectory mode
    }

    // No migration needed for transport (new feature)
    if (currentSubDir === STORAGE_SUBDIRS.TRANSPORT) {
      return;
    }

    const configDir = path.dirname(path.dirname(this.storageDir)); // Get config root

    // Determine source directory based on subdirectory type
    let sourceDir: string;
    if (currentSubDir === STORAGE_SUBDIRS.CLIENT) {
      // Client sessions: migrate from clientSessions/
      sourceDir = path.join(configDir, 'clientSessions');
    } else {
      // Server sessions: migrate from sessions/ (flat)
      sourceDir = path.join(configDir, AUTH_CONFIG.SERVER.STORAGE.DIR);
    }

    if (!fs.existsSync(sourceDir)) {
      return; // No legacy directory to migrate from
    }

    // Check subdirectory-specific migration flag
    const migrationFlagPath = path.join(sourceDir, `.migrated-to-${currentSubDir}`);
    if (fs.existsSync(migrationFlagPath)) {
      logger.debug(`Migration from ${sourceDir} to ${currentSubDir} already completed`);
      return;
    }

    const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      this.createMigrationFlag(sourceDir, currentSubDir);
      return;
    }

    let migrationCount = 0;

    // Migrate files matching current subdirectory's prefixes
    for (const file of files) {
      const shouldMigrate = this.shouldMigrateFile(file, currentSubDir);

      if (shouldMigrate) {
        const oldPath = path.join(sourceDir, file);
        const newPath = path.join(this.storageDir, file);

        try {
          fs.renameSync(oldPath, newPath);
          migrationCount++;
          logger.info(`Migrated ${file} from ${sourceDir} to ${this.storageDir}`);
        } catch (error) {
          logger.error(`Failed to migrate ${file}: ${error}`);
        }
      }
    }

    if (migrationCount > 0) {
      this.createMigrationFlag(sourceDir, currentSubDir);
      logger.info(`Migration completed: ${migrationCount} files migrated to ${currentSubDir}/`);
    } else {
      this.createMigrationFlag(sourceDir, currentSubDir);
    }
  }

  /**
   * Creates migration completion flag file
   */
  private createMigrationFlag(sourceDir: string, targetSubDir: string): void {
    try {
      const migrationFlagPath = path.join(sourceDir, `.migrated-to-${targetSubDir}`);
      fs.writeFileSync(
        migrationFlagPath,
        JSON.stringify({
          migrated: true,
          targetSubDir,
          timestamp: Date.now(),
        }),
      );
      logger.debug(`Created migration flag: .migrated-to-${targetSubDir} in ${sourceDir}`);
    } catch (error) {
      logger.warn(`Failed to create migration flag: ${error}`);
    }
  }

  /**
   * Extract current subdirectory name from storage directory path
   */
  private getCurrentSubDir(): string | null {
    const subdirValues = Object.values(STORAGE_SUBDIRS);
    for (const subdir of subdirValues) {
      if (this.storageDir.endsWith(path.sep + subdir)) {
        return subdir;
      }
    }
    return null;
  }

  /**
   * Check if file should be migrated to current subdirectory based on prefix
   */
  private shouldMigrateFile(fileName: string, targetSubDir: string): boolean {
    // Get prefixes for target subdirectory
    const prefixMapping: Record<string, readonly string[]> = {
      [STORAGE_SUBDIRS.SERVER]: FILE_PREFIX_MAPPING.SERVER,
      [STORAGE_SUBDIRS.CLIENT]: FILE_PREFIX_MAPPING.CLIENT,
      [STORAGE_SUBDIRS.TRANSPORT]: FILE_PREFIX_MAPPING.TRANSPORT,
    };

    const prefixes = prefixMapping[targetSubDir];
    if (!prefixes) return false;

    return prefixes.some((prefix) => fileName.startsWith(prefix));
  }

  /**
   * Gets the file path for a given prefix and ID
   */
  public getFilePath(filePrefix: string, id: string): string {
    if (!this.isValidId(id, filePrefix)) {
      throw new Error(`Invalid ID format: ${id}`);
    }

    const fileName = `${filePrefix}${id}${AUTH_CONFIG.SERVER.STORAGE.FILE_EXTENSION}`;
    const filePath = path.resolve(this.storageDir, fileName);

    // Security check: ensure resolved path is within storage directory
    const normalizedStorageDir = path.resolve(this.storageDir);
    const normalizedFilePath = path.resolve(filePath);

    if (!normalizedFilePath.startsWith(normalizedStorageDir + path.sep)) {
      throw new Error('Invalid file path: outside storage directory');
    }

    return filePath;
  }

  /**
   * Validates ID format for security
   */
  private isValidId(id: string, filePrefix?: string): boolean {
    // Check minimum length (prefix + content)
    if (!id || id.length < 8) {
      return false;
    }

    if (filePrefix === AUTH_CONFIG.SERVER.REFRESH_FAMILY.LOOKUP_FILE_PREFIX) {
      const { LOOKUP_ID_PREFIX } = AUTH_CONFIG.SERVER.REFRESH_FAMILY;
      return id.startsWith(LOOKUP_ID_PREFIX) && /^[a-f0-9]{64}$/.test(id.slice(LOOKUP_ID_PREFIX.length));
    }

    // Check for valid server-side prefix
    const serverPrefixes = [
      AUTH_CONFIG.SERVER.SESSION.ID_PREFIX,
      AUTH_CONFIG.SERVER.AUTH_CODE.ID_PREFIX,
      AUTH_CONFIG.SERVER.AUTH_REQUEST.ID_PREFIX,
      AUTH_CONFIG.SERVER.REFRESH_FAMILY.ID_PREFIX,
      AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX,
    ];

    for (const prefix of serverPrefixes) {
      if (id.startsWith(prefix)) {
        try {
          const uuidPart = this.extractUuidPart(id, prefix);
          // UUID v4 format: 8-4-4-4-12 hexadecimal digits with hyphens
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          return uuidRegex.test(uuidPart);
        } catch (error) {
          logger.debug(`extractUuidPart failed for id=${id}, prefix=${prefix}`, { error });
          return false;
        }
      }
    }

    if (filePrefix === AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX && /^rest-[0-9a-f]{16}$/.test(id)) {
      return true;
    }

    // Check for valid client-side OAuth prefix
    const clientPrefixes = [
      AUTH_CONFIG.CLIENT.PREFIXES.CLIENT,
      AUTH_CONFIG.CLIENT.PREFIXES.TOKENS,
      AUTH_CONFIG.CLIENT.PREFIXES.VERIFIER,
      AUTH_CONFIG.CLIENT.PREFIXES.STATE,
    ];

    for (const prefix of clientPrefixes) {
      if (id.startsWith(prefix)) {
        const contentPart = id.substring(prefix.length);
        return contentPart.length > 0 && /^[a-zA-Z0-9_-]+$/.test(contentPart);
      }
    }

    // Check for client session prefix
    if (id.startsWith(AUTH_CONFIG.CLIENT.SESSION.ID_PREFIX)) {
      const contentPart = id.substring(AUTH_CONFIG.CLIENT.SESSION.ID_PREFIX.length);
      return contentPart.length > 0 && /^[a-zA-Z0-9_-]+$/.test(contentPart);
    }

    return false;
  }

  /**
   * Writes data to a file with the specified prefix and ID
   */
  writeData<T extends ExpirableData>(filePrefix: string, id: string, data: T): void {
    try {
      const filePath = this.getFilePath(filePrefix, id);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      logger.debug(`Wrote data to ${filePath}`);
    } catch (error) {
      logger.error(`Failed to write data for ${id}: ${error}`);
      throw error;
    }
  }

  /**
   * Atomically replaces a record and flushes it before returning.
   */
  writeDataDurable<T extends ExpirableData>(filePrefix: string, id: string, data: T): void {
    let temporaryPath: string | undefined;
    try {
      const filePath = this.getFilePath(filePrefix, id);
      temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      const fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fileDescriptor, JSON.stringify(data, null, 2));
        fs.fsyncSync(fileDescriptor);
      } finally {
        fs.closeSync(fileDescriptor);
      }
      fs.renameSync(temporaryPath, filePath);
      temporaryPath = undefined;
      this.flushStorageDirectory();
      logger.debug(`Wrote data to ${filePath}`);
    } catch (error) {
      if (temporaryPath) {
        try {
          fs.unlinkSync(temporaryPath);
        } catch {
          // A later startup cleanup removes abandoned temporary files.
        }
      }
      logger.error(`Failed to write data for ${id}: ${error}`);
      throw error;
    }
  }

  /**
   * Reads data from a file with the specified prefix and ID
   * Returns null if file doesn't exist or data is expired
   */
  readData<T extends ExpirableData>(filePrefix: string, id: string, schema?: ZodType<T>): T | null {
    if (!this.isValidId(id, filePrefix)) {
      logger.warn(`Rejected readData with invalid ID: ${id}`);
      return null;
    }

    try {
      const filePath = this.getFilePath(filePrefix, id);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf8');
      const parsed: unknown = JSON.parse(data);
      const parsedData = schema ? schema.parse(parsed) : (parsed as T);

      // Check if data is expired
      if (parsedData.expires < Date.now()) {
        this.deleteData(filePrefix, id);
        return null;
      }

      return parsedData;
    } catch (error) {
      logger.error(`Failed to read data for ${id}: ${error}`);
      return null;
    }
  }

  /**
   * Deletes data file with the specified prefix and ID
   */
  deleteData(filePrefix: string, id: string): boolean {
    if (!this.isValidId(id, filePrefix)) {
      logger.warn(`Rejected deleteData with invalid ID: ${id}`);
      return false;
    }

    try {
      const filePath = this.getFilePath(filePrefix, id);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.debug(`Deleted data file: ${filePath}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to delete data for ${id}: ${error}`);
      throw error;
    }
  }

  /**
   * Runs a storage transition under an inter-process lock.
   *
   * Lock ownership is recorded so a process that dies while holding the lock
   * cannot block the Runtime Scope permanently.
   */
  async withExclusiveLock<T>(lockName: string, operation: () => Promise<T> | T): Promise<T> {
    if (!/^[a-z0-9-]+$/.test(lockName)) {
      throw new Error(`Invalid storage lock name: ${lockName}`);
    }

    const lockPath = path.join(this.storageDir, `.${lockName}.lock`);
    const operationId = randomUUID();
    const deadline = Date.now() + 10_000;

    while (!this.tryAcquireLock(lockPath, operationId)) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring storage lock: ${lockName}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 10)));
    }

    try {
      return await operation();
    } finally {
      this.releaseLock(lockPath, operationId);
    }
  }

  /**
   * Starts periodic cleanup of expired data files
   */
  private startPeriodicCleanup(): void {
    // Clean up expired data every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredData();
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Unified cleanup for all expired data types
   */
  public cleanupExpiredData(): number {
    try {
      const files = fs.readdirSync(this.storageDir);
      let cleanedCount = 0;

      for (const file of files) {
        if (file.includes('.json.') && file.endsWith('.tmp')) {
          const temporaryPath = path.join(this.storageDir, file);
          try {
            const ageMs = Date.now() - fs.statSync(temporaryPath).mtimeMs;
            if (ageMs >= 60_000) {
              fs.unlinkSync(temporaryPath);
              cleanedCount++;
            }
          } catch (error) {
            logger.warn(`Failed to clean temporary file ${file}: ${error}`);
          }
          continue;
        }

        if (file.endsWith(AUTH_CONFIG.SERVER.STORAGE.FILE_EXTENSION)) {
          const filePath = path.join(this.storageDir, file);
          try {
            const data = fs.readFileSync(filePath, 'utf8');
            const parsedData = JSON.parse(data) as { expires?: number };

            // Check if expired (all our data types have expires field)
            if (parsedData.expires && parsedData.expires < Date.now()) {
              fs.unlinkSync(filePath);
              cleanedCount++;
              logger.debug(`Cleaned up expired file: ${file}`);
            }
          } catch (error) {
            // Remove corrupted files
            logger.warn(`Removing corrupted file ${file}: ${error}`);
            try {
              fs.unlinkSync(filePath);
              cleanedCount++;
            } catch (unlinkError) {
              logger.error(`Failed to remove corrupted file ${file}: ${unlinkError}`);
            }
          }
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} expired/corrupted files`);
      }
      return cleanedCount;
    } catch (error) {
      logger.error(`Failed to cleanup expired data: ${error}`);
      return 0;
    }
  }

  /**
   * Lists all files in the storage directory that match a given prefix.
   *
   * @param filePrefix - The file prefix to filter by (optional)
   * @returns Array of file names (without directory path)
   */
  listFiles(filePrefix?: string): string[] {
    try {
      if (!fs.existsSync(this.storageDir)) {
        return [];
      }

      const files = fs.readdirSync(this.storageDir);
      return files.filter((file) => {
        if (!file.endsWith('.json')) {
          return false;
        }

        if (filePrefix) {
          return file.startsWith(filePrefix);
        }

        return true;
      });
    } catch (error) {
      logger.error(`Failed to list files: ${error}`);
      return [];
    }
  }

  /**
   * Gets the storage directory path
   */
  getStorageDir(): string {
    return this.storageDir;
  }

  /**
   * Graceful shutdown - stops cleanup interval
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('FileStorageService cleanup interval stopped');
    }
  }

  private flushStorageDirectory(): void {
    try {
      const directoryDescriptor = fs.openSync(this.storageDir, 'r');
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    } catch (error) {
      if (
        process.platform === 'win32' &&
        error instanceof Error &&
        'code' in error &&
        ['EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(String(error.code))
      ) {
        return;
      }
      throw error;
    }
  }

  private tryAcquireLock(lockPath: string, operationId: string): boolean {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }
      this.reclaimAbandonedLock(lockPath);
      return false;
    }

    try {
      fs.writeFileSync(
        path.join(lockPath, 'owner.json'),
        JSON.stringify({ operationId, pid: process.pid, createdAt: Date.now() }),
        { mode: 0o600, flag: 'wx' },
      );
      this.flushStorageDirectory();
      return true;
    } catch (error) {
      const owner = this.readLockOwner(lockPath);
      if (owner?.operationId === operationId) {
        try {
          removeLockDirectory(lockPath);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Failed to initialize storage lock: ${lockPath}`);
        }
      }
      if (isFileExistsError(error)) {
        return false;
      }
      throw error;
    }
  }

  private reclaimAbandonedLock(lockPath: string): void {
    const owner = this.readLockOwner(lockPath);
    if (owner && isProcessAlive(owner.pid)) {
      return;
    }

    if (!owner) {
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs < 1_000) {
          return;
        }
      } catch {
        return;
      }
    }

    const observedOperationId = owner?.operationId;
    const tombstonePath = `${lockPath}.${randomUUID()}.stale`;
    try {
      fs.renameSync(lockPath, tombstonePath);
    } catch {
      return;
    }

    const movedOwner = this.readLockOwner(tombstonePath);
    if (observedOperationId && movedOwner?.operationId !== observedOperationId) {
      try {
        fs.renameSync(tombstonePath, lockPath);
      } catch {
        // Another contender will reconcile the surviving generation.
      }
      return;
    }

    removeLockDirectory(tombstonePath);
  }

  private releaseLock(lockPath: string, operationId: string): void {
    const owner = this.readLockOwner(lockPath);
    if (owner?.operationId !== operationId) {
      logger.error(`Storage lock ownership changed before release: ${lockPath}`);
      return;
    }

    const tombstonePath = `${lockPath}.${operationId}.releasing`;
    try {
      fs.renameSync(lockPath, tombstonePath);
    } catch (renameError) {
      const currentOwner = this.readLockOwner(lockPath);
      if (!currentOwner && !fs.existsSync(lockPath)) {
        logger.warn(`Storage lock disappeared during release: ${lockPath}`);
        return;
      }
      if (currentOwner?.operationId !== operationId) {
        logger.error(`Storage lock ownership changed during release: ${lockPath}`);
        throw renameError;
      }

      try {
        removeLockDirectory(lockPath);
      } catch (cleanupError) {
        throw new AggregateError(
          [renameError, cleanupError],
          `Failed to release storage lock after rename failure: ${lockPath}`,
        );
      }

      try {
        this.flushStorageDirectory();
      } catch (flushError) {
        logger.error(`Failed to flush storage directory after lock release ${lockPath}: ${flushError}`);
      }
      logger.warn(`Released storage lock without rename after rename failure: ${lockPath}`);
      return;
    }

    try {
      removeLockDirectory(tombstonePath);
      this.flushStorageDirectory();
    } catch (error) {
      logger.error(`Failed to release storage lock ${lockPath}: ${error}`);
    }
  }

  private readLockOwner(lockPath: string): { operationId: string; pid: number } | null {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
      const result = StorageLockOwnerSchema.safeParse(value);
      return result.success ? { operationId: result.data.operationId, pid: result.data.pid } : null;
    } catch {
      return null;
    }
  }
}

function isFileExistsError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function removeLockDirectory(lockPath: string): void {
  try {
    fs.unlinkSync(path.join(lockPath, 'owner.json'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
  fs.rmdirSync(lockPath);
}
