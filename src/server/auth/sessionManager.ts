import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import logger from '../../logger/logger.js';
import { AUTH_CONFIG, getGlobalConfigDir } from '../../constants.js';

/**
 * Represents session data stored for access tokens.
 *
 * Contains all necessary information to validate and manage user sessions
 * including client identification, resource access, and expiration details.
 */
export interface SessionData {
  /** The client ID that owns this session */
  clientId: string;
  /** The resource this session has access to */
  resource: string;
  /** Unix timestamp when this session expires */
  expires: number;
  /** Unix timestamp when this session was created */
  createdAt: number;
}

/**
 * Represents authorization code data for OAuth 2.1 flow.
 *
 * Contains information about authorization codes used in the OAuth
 * authorization code grant flow, including client and redirect details.
 */
export interface AuthCodeData {
  /** The client ID that requested this authorization code */
  clientId: string;
  /** The redirect URI where the code should be used */
  redirectUri: string;
  /** The resource this code grants access to */
  resource: string;
  /** Unix timestamp when this code expires */
  expires: number;
  /** Unix timestamp when this code was created */
  createdAt: number;
}

/**
 * SessionManager handles file-based session storage with automatic cleanup.
 *
 * This class manages OAuth 2.1 sessions and authorization codes using
 * the local filesystem. It provides automatic cleanup of expired sessions
 * and supports configurable storage locations.
 *
 * Features:
 * - File-based session storage with JSON format
 * - Automatic cleanup of expired sessions every 5 minutes
 * - Prefixed identifiers for easy debugging
 * - Configurable storage directory
 *
 * @example
 * ```typescript
 * const sessionManager = new SessionManager('/custom/path');
 * const sessionId = sessionManager.createSession('client-123', 'resource', 3600000);
 * const session = sessionManager.getSession(sessionId);
 * ```
 */
export class SessionManager {
  private sessionStoragePath: string;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Creates a new SessionManager instance.
   *
   * Initializes the session storage directory and starts the automatic
   * cleanup process for expired sessions.
   *
   * @param sessionStoragePath - Optional custom path for session storage
   */
  constructor(sessionStoragePath?: string) {
    this.sessionStoragePath = sessionStoragePath || path.join(getGlobalConfigDir(), AUTH_CONFIG.SESSION_STORAGE_DIR);
    this.ensureSessionDirectory();
    this.startCleanupInterval();
  }

  /**
   * Ensures the session storage directory exists.
   *
   * Creates the directory structure if it doesn't exist, including
   * parent directories as needed.
   *
   * @throws Error if directory creation fails
   */
  private ensureSessionDirectory(): void {
    try {
      if (!fs.existsSync(this.sessionStoragePath)) {
        fs.mkdirSync(this.sessionStoragePath, { recursive: true });
        logger.info(`Created session storage directory: ${this.sessionStoragePath}`);
      }
    } catch (error) {
      logger.error(`Failed to create session directory: ${error}`);
      throw error;
    }
  }

  /**
   * Gets the file path for a session ID.
   *
   * @param sessionId - The session identifier
   * @returns Full file path for the session file
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(
      this.sessionStoragePath,
      `${AUTH_CONFIG.SESSION_FILE_PREFIX}${sessionId}${AUTH_CONFIG.SESSION_FILE_EXTENSION}`,
    );
  }

  /**
   * Gets the file path for an authorization code.
   *
   * @param code - The authorization code
   * @returns Full file path for the auth code file
   */
  private getAuthCodeFilePath(code: string): string {
    const unsafePath = path.join(this.sessionStoragePath, `auth_code_${code}${AUTH_CONFIG.SESSION_FILE_EXTENSION}`);
    const normalizedPath = fs.realpathSync(path.resolve(unsafePath));
    if (!normalizedPath.startsWith(this.sessionStoragePath)) {
      throw new Error('Invalid authorization code path');
    }
    return normalizedPath;
  }

  /**
   * Creates a new session with the specified parameters.
   *
   * Generates a unique session ID with prefix, stores the session data
   * as a JSON file, and returns the session identifier.
   *
   * @param clientId - The client identifier
   * @param resource - The resource this session can access
   * @param ttlMs - Time-to-live in milliseconds
   * @returns The generated session ID with prefix
   * @throws Error if session creation fails
   */
  public createSession(clientId: string, resource: string, ttlMs: number): string {
    const sessionId = AUTH_CONFIG.PREFIXES.SESSION_ID + randomUUID();
    const sessionData: SessionData = {
      clientId,
      resource,
      expires: Date.now() + ttlMs,
      createdAt: Date.now(),
    };

    try {
      const filePath = this.getSessionFilePath(sessionId);
      fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
      logger.info(`Created session: ${sessionId} for client: ${clientId}`);
      return sessionId;
    } catch (error) {
      logger.error(`Failed to create session: ${error}`);
      throw error;
    }
  }

  /**
   * Retrieves session data by session ID.
   *
   * Reads the session file and validates expiration. If the session
   * is expired, it's automatically deleted and null is returned.
   *
   * @param sessionId - The session identifier to retrieve
   * @returns Session data if valid and not expired, null otherwise
   */
  public getSession(sessionId: string): SessionData | null {
    try {
      const filePath = this.getSessionFilePath(sessionId);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf8');
      const sessionData: SessionData = JSON.parse(data);

      if (sessionData.expires < Date.now()) {
        this.deleteSession(sessionId);
        return null;
      }

      return sessionData;
    } catch (error) {
      logger.error(`Failed to read session ${sessionId}: ${error}`);
      return null;
    }
  }

  /**
   * Deletes a session by session ID.
   *
   * Removes the session file from the filesystem if it exists.
   *
   * @param sessionId - The session identifier to delete
   * @returns True if session was deleted, false if it didn't exist
   */
  public deleteSession(sessionId: string): boolean {
    try {
      const filePath = this.getSessionFilePath(sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted session: ${sessionId}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to delete session ${sessionId}: ${error}`);
      return false;
    }
  }

  /**
   * Creates a new authorization code for OAuth 2.1 flow.
   *
   * Generates a unique authorization code with prefix, stores the code data
   * as a JSON file, and returns the code identifier.
   *
   * @param clientId - The client identifier
   * @param redirectUri - The redirect URI for this code
   * @param resource - The resource this code grants access to
   * @param ttlMs - Time-to-live in milliseconds
   * @returns The generated authorization code with prefix
   * @throws Error if code creation fails
   */
  public createAuthCode(clientId: string, redirectUri: string, resource: string, ttlMs: number): string {
    const code = AUTH_CONFIG.PREFIXES.AUTH_CODE + randomUUID();
    const authCodeData: AuthCodeData = {
      clientId,
      redirectUri,
      resource,
      expires: Date.now() + ttlMs,
      createdAt: Date.now(),
    };

    try {
      const filePath = this.getAuthCodeFilePath(code);
      fs.writeFileSync(filePath, JSON.stringify(authCodeData, null, 2));
      logger.info(`Created auth code: ${code} for client: ${clientId}`);
      return code;
    } catch (error) {
      logger.error(`Failed to create auth code: ${error}`);
      throw error;
    }
  }

  /**
   * Retrieves authorization code data by code.
   *
   * Reads the auth code file and validates expiration. If the code
   * is expired, it's automatically deleted and null is returned.
   *
   * @param code - The authorization code to retrieve
   * @returns Auth code data if valid and not expired, null otherwise
   */
  public getAuthCode(code: string): AuthCodeData | null {
    try {
      const filePath = this.getAuthCodeFilePath(code);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf8');
      const authCodeData: AuthCodeData = JSON.parse(data);

      if (authCodeData.expires < Date.now()) {
        this.deleteAuthCode(code);
        return null;
      }

      return authCodeData;
    } catch (error) {
      logger.error(`Failed to read auth code ${code}: ${error}`);
      return null;
    }
  }

  /**
   * Deletes an authorization code by code.
   *
   * Removes the auth code file from the filesystem if it exists.
   *
   * @param code - The authorization code to delete
   * @returns True if code was deleted, false if it didn't exist
   */
  public deleteAuthCode(code: string): boolean {
    try {
      const filePath = this.getAuthCodeFilePath(code);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted auth code: ${code}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to delete auth code ${code}: ${error}`);
      return false;
    }
  }

  /**
   * Starts the automatic cleanup interval for expired sessions.
   *
   * Runs cleanup every 5 minutes to remove expired sessions and
   * authorization codes from the filesystem.
   */
  private startCleanupInterval(): void {
    // Clean up expired sessions every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredSessions();
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Cleans up expired sessions and authorization codes.
   *
   * Scans the session storage directory and removes all expired
   * session and auth code files. Also handles corrupted files
   * by removing them to prevent future errors.
   */
  private cleanupExpiredSessions(): void {
    try {
      const files = fs.readdirSync(this.sessionStoragePath);
      let cleanedCount = 0;

      for (const file of files) {
        if (file.endsWith(AUTH_CONFIG.SESSION_FILE_EXTENSION)) {
          const filePath = path.join(this.sessionStoragePath, file);
          try {
            const data = fs.readFileSync(filePath, 'utf8');
            const sessionData = JSON.parse(data);

            if (sessionData.expires < Date.now()) {
              fs.unlinkSync(filePath);
              cleanedCount++;
            }
          } catch (error) {
            logger.warn(`Failed to process session file ${file}: ${error}`);
            // Remove corrupted files
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
        logger.info(`Cleaned up ${cleanedCount} expired sessions`);
      }
    } catch (error) {
      logger.error(`Failed to cleanup expired sessions: ${error}`);
    }
  }

  /**
   * Performs graceful shutdown of the SessionManager.
   *
   * Stops the cleanup interval to prevent memory leaks and
   * ensures proper resource cleanup.
   */
  public shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
