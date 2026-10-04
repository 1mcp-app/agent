import fs from 'fs';
import { randomUUID } from 'node:crypto';
import path from 'path';

import { ExpirableData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG, FILE_PREFIX_MAPPING, getGlobalConfigDir, STORAGE_SUBDIRS } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import {
  assertOwnerOnlyDirPermissions,
  credentialReadFlags,
  enforceOwnerOnlyFilePermissions,
  InsecureFilePermissionsError,
  openCredentialReadSync,
} from '@src/utils/filePermissions.js';

import { z, type ZodType } from 'zod';

// Re-export so existing importers keep working; the canonical home is
// src/utils/filePermissions.ts, shared by all credential stores.
export { InsecureFilePermissionsError };

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
   * Hardens file or directory permissions on POSIX systems.
   * Tolerates filesystems that lack POSIX permission capabilities (e.g. FAT, exFAT, FUSE)
   * only when explicitly allowed (such as during storage directory initialization).
   * For credentials and migration flags, or real permission violations (EACCES, EPERM, EROFS),
   * it strictly fails closed by rethrowing.
   */
  private hardenPermissionsSafely(
    targetPath: string,
    mode: number,
    options: { degradeCapabilityErrors?: boolean } = {},
  ): void {
    if (process.platform === 'win32') {
      return;
    }
    const { degradeCapabilityErrors = false } = options;
    try {
      fs.chmodSync(targetPath, mode);
    } catch (error: unknown) {
      const code =
        error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? String((error as { code: string }).code)
          : '';
      if (degradeCapabilityErrors && ['ENOTSUP', 'EOPNOTSUPP', 'EINVAL', 'ENOSYS'].includes(code)) {
        logger.warn(
          'fileStorageService.chmod.unsupported.on.filesystem.lacks.posix.permission.capabilities.degradi.fa8e2186',
          { error: error },
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Ensures the storage directory exists
   */
  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
        logger.info('fileStorageService.created.storage.directory.457c7184');
      }
      if (process.platform !== 'win32') {
        this.hardenPermissionsSafely(this.storageDir, 0o700, { degradeCapabilityErrors: true });
      }
    } catch (error) {
      logger.error('fileStorageService.failed.to.create.storage.directory.8d6e79fa', { error: error });
      throw error;
    }
  }

  /**
   * Extracts UUID part from an ID by removing the prefix
   */
  private extractUuidPart(id: string, prefix: string): string {
    if (!id.startsWith(prefix)) {
      const loggableId = this.isSensitivePrefix(prefix) || this.isSensitivePrefix(id) ? '[REDACTED]' : id;
      throw new Error(`Invalid ID prefix: expected ${prefix}, got ${loggableId}`);
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
      if (process.platform !== 'win32') {
        try {
          this.hardenPermissionsSafely(migrationFlagPath, 0o600);
        } catch (error) {
          logger.error('fileStorageService.failed.to.harden.migration.flag.permissions.69dfb23b', { error: error });
          throw error;
        }
      }
      logger.debug('fileStorageService.migration.from.to.already.completed.c86350f8');
      return;
    }

    const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      this.createMigrationFlag(sourceDir, currentSubDir);
      return;
    }

    let migrationCount = 0;
    let hasFailures = false;

    // Migrate files matching current subdirectory's prefixes
    for (const file of files) {
      const shouldMigrate = this.shouldMigrateFile(file, currentSubDir);

      if (shouldMigrate) {
        const oldPath = path.join(sourceDir, file);
        const newPath = path.join(this.storageDir, file);

        try {
          if (process.platform !== 'win32') {
            this.hardenPermissionsSafely(oldPath, 0o600);
          }
          fs.renameSync(oldPath, newPath);
          if (process.platform !== 'win32') {
            this.hardenPermissionsSafely(newPath, 0o600);
          }
          migrationCount++;
          logger.info('fileStorageService.migrated.from.to.474c939b');
        } catch (_error) {
          hasFailures = true;
          logger.error('fileStorageService.failed.to.migrate.7d2a3922', { error: _error });
        }
      }
    }

    if (!hasFailures) {
      this.createMigrationFlag(sourceDir, currentSubDir);
      if (migrationCount > 0) {
        logger.info('fileStorageService.migration.completed.files.migrated.to.9086112b');
      }
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
        { mode: 0o600 },
      );
      if (process.platform !== 'win32') {
        this.hardenPermissionsSafely(migrationFlagPath, 0o600);
      }
      logger.debug('fileStorageService.created.migration.flag.migrated.to.in.b89fe290');
    } catch (error) {
      logger.error('fileStorageService.failed.to.create.migration.flag.ef732c12', { error: error });
      throw error;
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
    if (filePrefix && ['oauth-bound-', 'oauth-context-', 'oauth-quarantine-'].includes(filePrefix))
      return /^[a-f0-9]{64}$/.test(id);
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
          const isSensitive = this.isSensitivePrefix(prefix) || this.isSensitivePrefix(id);

          const loggableError = isSensitive ? this.getLoggableError(prefix, error) : error;
          logger.debug('fileStorageService.extractuuidpart.failed.for.id.prefix.69442aa5', { error: loggableError });
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

  private static getSensitivePrefixes(): readonly string[] {
    return [
      'oauth-',
      AUTH_CONFIG?.CLIENT?.SESSION?.FILE_PREFIX ?? 'client_session_',
      AUTH_CONFIG?.SERVER?.AUTH_CODE?.FILE_PREFIX ?? 'auth_code_',
      AUTH_CONFIG?.SERVER?.AUTH_CODE?.ID_PREFIX ?? 'code-',
      AUTH_CONFIG?.SERVER?.AUTH_REQUEST?.FILE_PREFIX ?? 'auth_request_',
      AUTH_CONFIG?.SERVER?.AUTH_REQUEST?.ID_PREFIX ?? 'req-',
    ].filter((prefix) => prefix.length > 0);
  }

  /**
   * Checks if an ID/filePrefix or filename represents sensitive data that should be redacted from logs.
   */
  private isSensitivePrefix(prefixOrFileName?: string): boolean {
    if (!prefixOrFileName) return false;
    return FileStorageService.getSensitivePrefixes().some((prefix) => prefixOrFileName.startsWith(prefix));
  }

  /**
   * Gets a log-safe representation of an ID.
   */
  private getLoggableId(filePrefix: string, id: string): string {
    if (this.isSensitivePrefix(filePrefix)) {
      return '[REDACTED]';
    }
    return id;
  }

  /**
   * Gets a log-safe representation of a file path.
   */
  private getLoggableFilePath(filePrefix: string, id: string): string {
    if (this.isSensitivePrefix(filePrefix)) {
      return path.join(
        this.storageDir,
        `${filePrefix}[REDACTED]${AUTH_CONFIG?.SERVER?.STORAGE?.FILE_EXTENSION ?? '.json'}`,
      );
    }
    return this.getFilePath(filePrefix, id);
  }

  /**
   * Gets a log-safe representation of an error object.
   */
  private getLoggableError(filePrefix: string, error: unknown): string {
    if (this.isSensitivePrefix(filePrefix)) {
      if (error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
        return `${error.name} (${(error as { code: string }).code})`;
      }
      return '[REDACTED]';
    }
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Gets a log-safe representation of a file name (including .tmp files).
   */
  private getLoggableFileName(fileName: string): string {
    for (const prefix of FileStorageService.getSensitivePrefixes()) {
      if (fileName.startsWith(prefix)) {
        if (fileName.endsWith('.tmp')) {
          return `${prefix}[REDACTED].tmp`;
        }
        return `${prefix}[REDACTED]${AUTH_CONFIG?.SERVER?.STORAGE?.FILE_EXTENSION ?? '.json'}`;
      }
    }
    return fileName;
  }

  /**
   * Gets a log-safe representation of an error object associated with a file name.
   */
  private getLoggableErrorForFileName(fileName: string, error: unknown): string {
    if (this.isSensitivePrefix(fileName)) {
      if (error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
        return `${error.name} (${(error as { code: string }).code})`;
      }
      return '[REDACTED]';
    }
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Internal unified atomic write primitive:
   * Uses O_CREAT | O_EXCL with mode 0o600 for safe temporary file creation,
   * writes data, optionally fsyncs, and atomically renames to the destination path.
   */
  private writeDataAtomic<T extends ExpirableData>(
    filePrefix: string,
    id: string,
    data: T,
    options: { durable?: boolean } = {},
  ): void {
    const { durable = false } = options;
    let temporaryPath: string | undefined;
    let created = false;
    try {
      // Write-side directory gate (heal-then-consume, same policy as read/listFile/cleanup):
      // a pre-existing permissive storage dir is tightened to 0700 before the temp file lands in it.
      assertOwnerOnlyDirPermissions(this.getStorageDir());
      const filePath = this.getFilePath(filePrefix, id);
      temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      const fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      created = true;
      try {
        fs.writeFileSync(fileDescriptor, JSON.stringify(data, null, 2));
        if (durable) {
          fs.fsyncSync(fileDescriptor);
        }
      } finally {
        fs.closeSync(fileDescriptor);
      }
      fs.renameSync(temporaryPath, filePath);
      temporaryPath = undefined;
      if (durable) {
        this.flushStorageDirectory();
      }
      logger.debug('fileStorageService.wrote.data.to.0d444b04');
    } catch (error) {
      if (temporaryPath && created) {
        try {
          fs.unlinkSync(temporaryPath);
        } catch {
          // A later startup cleanup removes abandoned temporary files.
        }
      }
      logger.error('fileStorageService.failed.to.write.data.for.1dcbea2a', { error: error });
      throw error;
    }
  }

  /**
   * Writes data to a file with the specified prefix and ID
   */
  writeData<T extends ExpirableData>(filePrefix: string, id: string, data: T): void {
    this.writeDataAtomic(filePrefix, id, data, { durable: false });
  }

  /**
   * Atomically replaces a record and flushes it before returning.
   */
  writeDataDurable<T extends ExpirableData>(filePrefix: string, id: string, data: T): void {
    this.writeDataAtomic(filePrefix, id, data, { durable: true });
  }

  /**
   * Reads data from a file with the specified prefix and ID
   * Returns null if file doesn't exist or data is expired
   */
  readData<T extends ExpirableData>(filePrefix: string, id: string, schema?: ZodType<T>): T | null {
    if (!this.isValidId(id, filePrefix)) {
      logger.warn('fileStorageService.rejected.readdata.with.invalid.id.81150da1');
      return null;
    }

    try {
      const filePath = this.getFilePath(filePrefix, id);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      assertOwnerOnlyDirPermissions(this.getStorageDir());

      // open → fstat → read on one descriptor, closing the TOCTOU gap
      // between a permission check and a separate open. O_NOFOLLOW rejects a
      // planted symlink at open time and maps it to InsecureFilePermissionsError
      // (observable fail-closed) instead of a silent "credential missing".
      const fd = openCredentialReadSync(filePath);
      let data: string;
      try {
        enforceOwnerOnlyFilePermissions(fd, filePath);
        data = fs.readFileSync(fd, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      const parsed: unknown = JSON.parse(data);
      const parsedData = schema ? schema.parse(parsed) : (parsed as T);

      // Check if data is expired
      if (parsedData.expires < Date.now()) {
        this.deleteData(filePrefix, id);
        return null;
      }

      return parsedData;
    } catch (error) {
      if (error instanceof InsecureFilePermissionsError) {
        throw error;
      }
      logger.error('fileStorageService.failed.to.read.data.for.709c6b64', { error: error });
      return null;
    }
  }

  /**
   * Deletes data file with the specified prefix and ID
   */
  deleteData(filePrefix: string, id: string): boolean {
    if (!this.isValidId(id, filePrefix)) {
      logger.warn('fileStorageService.rejected.deletedata.with.invalid.id.a25fcab7');
      return false;
    }

    try {
      const filePath = this.getFilePath(filePrefix, id);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.debug('fileStorageService.deleted.data.file.8587c119');
        return true;
      }
      return false;
    } catch (error) {
      logger.error('fileStorageService.failed.to.delete.data.for.391c9b0b', { error: error });
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
      // Directory leg: enumerating the storage dir is also credential access
      // surface — heal/assert it before readdir, same as readData.
      assertOwnerOnlyDirPermissions(this.storageDir);
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
          } catch (_error) {
            logger.warn('fileStorageService.failed.to.clean.temporary.file.48c7fb76', { error: _error });
          }
          continue;
        }

        if (file.endsWith(AUTH_CONFIG.SERVER.STORAGE.FILE_EXTENSION)) {
          const filePath = path.join(this.storageDir, file);
          let data: string;
          try {
            // Read through the same strictModes gate as readData: heal a
            // group/other-open legacy file before consuming its bytes.
            const fd = fs.openSync(filePath, credentialReadFlags());
            try {
              enforceOwnerOnlyFilePermissions(fd, filePath);
              data = fs.readFileSync(fd, 'utf8');
            } finally {
              fs.closeSync(fd);
            }
          } catch (_readError) {
            // Fail-closed means "do not consume", never "destroy the
            // credential" — unlink needs only dir write access, so any
            // open/heal/read failure must NOT turn into deletion.
            logger.warn('fileStorageService.skipping.unreadable.credential.file.b0d290a8', { error: _readError });
            continue;
          }
          try {
            // Deletion is only legitimate for content we actually consumed:
            // expired entries, or bytes we read but could not parse.
            const parsedData = JSON.parse(data) as { expires?: number };
            if (parsedData.expires && parsedData.expires < Date.now()) {
              try {
                fs.unlinkSync(filePath);
                cleanedCount++;
                logger.debug('fileStorageService.cleaned.up.expired.file.c453faef');
              } catch (_unlinkError) {
                logger.warn('fileStorageService.failed.to.remove.expired.file.5348882d', { error: _unlinkError });
              }
            }
          } catch (_error) {
            // Remove corrupted files (read succeeded, JSON parse failed)
            logger.warn('fileStorageService.removing.corrupted.file.e49d8b38', { error: _error });
            try {
              fs.unlinkSync(filePath);
              cleanedCount++;
            } catch (_unlinkError) {
              logger.error('fileStorageService.failed.to.remove.corrupted.file.0c104eb3', { error: _unlinkError });
            }
          }
        }
      }

      if (cleanedCount > 0) {
        logger.info('fileStorageService.cleaned.up.expired.corrupted.files.5d2edba3');
      }
      return cleanedCount;
    } catch (_error) {
      logger.error('fileStorageService.failed.to.cleanup.expired.data.59c8a76e', { error: _error });
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

      // Directory leg (I5): enumerating reveals which credential IDs exist —
      // assert/heal the dir before readdir, same as cleanupExpiredData.
      assertOwnerOnlyDirPermissions(this.storageDir);
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
    } catch (_error) {
      logger.error('fileStorageService.failed.to.list.files.b597413e', { error: _error });
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
      logger.info('fileStorageService.filestorageservice.cleanup.interval.stopped.381c8aed');
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
      logger.error('fileStorageService.storage.lock.ownership.changed.before.release.f36c6767');
      return;
    }

    const tombstonePath = `${lockPath}.${operationId}.releasing`;
    try {
      fs.renameSync(lockPath, tombstonePath);
    } catch (renameError) {
      const currentOwner = this.readLockOwner(lockPath);
      if (!currentOwner && !fs.existsSync(lockPath)) {
        logger.warn('fileStorageService.storage.lock.disappeared.during.release.c47b3b4c', { error: renameError });
        return;
      }
      if (currentOwner?.operationId !== operationId) {
        logger.error('fileStorageService.storage.lock.ownership.changed.during.release.efa9d04b', {
          error: renameError,
        });
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
      } catch (_flushError) {
        logger.error('fileStorageService.failed.to.flush.storage.directory.after.lock.release.ff0f3139', {
          error: _flushError,
        });
      }
      logger.warn('fileStorageService.released.storage.lock.without.rename.after.rename.failure.2f4c48e6', {
        error: renameError,
      });
      return;
    }

    try {
      removeLockDirectory(tombstonePath);
      this.flushStorageDirectory();
    } catch (_error) {
      logger.error('fileStorageService.failed.to.release.storage.lock.f179f145', { error: _error });
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
