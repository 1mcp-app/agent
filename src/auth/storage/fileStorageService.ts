import fs from 'fs';
import path from 'path';

import { ExpirableData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG, FILE_PREFIX_MAPPING, getGlobalConfigDir, STORAGE_SUBDIRS } from '@src/constants.js';
import logger from '@src/logger/logger.js';

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
   * Migrates old flat file structure to new subdirectory structure
   * Only runs if we're in a subdirectory and old files exist in parent
   */
  private migrateOldFilesIfNeeded(): void {
    // Only migrate if we're in a subdirectory
    const isSubdirectory = Object.values(STORAGE_SUBDIRS).some((subdir) => this.storageDir.endsWith(`/${subdir}`));

    if (!isSubdirectory) {
      return; // Not in subdirectory mode
    }

    const parentDir = path.dirname(this.storageDir);
    if (!fs.existsSync(parentDir)) {
      return;
    }

    // Check if migration has already been completed
    const migrationFlagPath = path.join(parentDir, '.migrated');
    if (fs.existsSync(migrationFlagPath)) {
      logger.debug('Migration already completed, skipping');
      return;
    }

    const files = fs.readdirSync(parentDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      // Create migration flag even if no files to migrate
      this.createMigrationFlag(parentDir);
      return;
    }

    let migrationCount = 0;

    // Determine where to move files based on prefix
    for (const file of files) {
      const targetSubDir = this.getTargetSubdirectory(file);

      if (targetSubDir) {
        const oldPath = path.join(parentDir, file);
        const newDir = path.join(parentDir, targetSubDir);
        const newPath = path.join(newDir, file);

        try {
          fs.mkdirSync(newDir, { recursive: true });
          fs.renameSync(oldPath, newPath);
          migrationCount++;
          logger.info(`Migrated ${file} to ${targetSubDir}/`);
        } catch (error) {
          logger.error(`Failed to migrate ${file}: ${error}`);
        }
      }
    }

    // Create migration flag after successful migration
    if (migrationCount > 0) {
      this.createMigrationFlag(parentDir);
      logger.info(`Migration completed: ${migrationCount} files migrated`);
    } else {
      // Create flag even if no files were migrated
      this.createMigrationFlag(parentDir);
    }
  }

  /**
   * Creates migration completion flag file
   */
  private createMigrationFlag(parentDir: string): void {
    try {
      const migrationFlagPath = path.join(parentDir, '.migrated');
      fs.writeFileSync(
        migrationFlagPath,
        JSON.stringify({
          migrated: true,
          timestamp: Date.now(),
        }),
      );
      logger.debug('Created migration completion flag');
    } catch (error) {
      logger.warn(`Failed to create migration flag: ${error}`);
    }
  }

  /**
   * Determines target subdirectory based on file prefix
   */
  private getTargetSubdirectory(fileName: string): string | null {
    for (const [subdir, prefixes] of Object.entries(FILE_PREFIX_MAPPING)) {
      const prefixList = prefixes as readonly string[];
      if (prefixList.some((prefix) => fileName.startsWith(prefix))) {
        return STORAGE_SUBDIRS[subdir as keyof typeof STORAGE_SUBDIRS];
      }
    }
    return null;
  }

  /**
   * Gets the file path for a given prefix and ID
   */
  public getFilePath(filePrefix: string, id: string): string {
    if (!this.isValidId(id)) {
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
  private isValidId(id: string): boolean {
    // Check minimum length (prefix + content)
    if (!id || id.length < 8) {
      return false;
    }

    // Check for valid server-side prefix
    const serverPrefixes = [
      AUTH_CONFIG.SERVER.SESSION.ID_PREFIX,
      AUTH_CONFIG.SERVER.AUTH_CODE.ID_PREFIX,
      AUTH_CONFIG.SERVER.AUTH_REQUEST.ID_PREFIX,
      AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX,
    ];

    for (const prefix of serverPrefixes) {
      if (id.startsWith(prefix)) {
        try {
          const uuidPart = this.extractUuidPart(id, prefix);
          // UUID v4 format: 8-4-4-4-12 hexadecimal digits with hyphens
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          return uuidRegex.test(uuidPart);
        } catch {
          return false;
        }
      }
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
   * Reads data from a file with the specified prefix and ID
   * Returns null if file doesn't exist or data is expired
   */
  readData<T extends ExpirableData>(filePrefix: string, id: string): T | null {
    if (!this.isValidId(id)) {
      logger.warn(`Rejected readData with invalid ID: ${id}`);
      return null;
    }

    try {
      const filePath = this.getFilePath(filePrefix, id);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf8');
      const parsedData: T = JSON.parse(data);

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
    if (!this.isValidId(id)) {
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
      return false;
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
        if (file.endsWith(AUTH_CONFIG.SERVER.STORAGE.FILE_EXTENSION)) {
          const filePath = path.join(this.storageDir, file);
          try {
            const data = fs.readFileSync(filePath, 'utf8');
            const parsedData = JSON.parse(data);

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
}
