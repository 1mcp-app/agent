import { AUTH_CONFIG, HOST, PORT, RATE_LIMIT_CONFIG, STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';

/**
 * Deep merge utility for nested objects
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || ({} as any), source[key] as any);
      } else {
        (result as any)[key] = source[key];
      }
    }
  }

  return result;
}

/**
 * Configuration interface for agent-specific settings.
 *
 * Defines the structure for authentication and session management configuration
 * that can be customized via CLI arguments or environment variables.
 */
export interface AgentConfig {
  host: string;
  port: number;
  externalUrl?: string;
  trustProxy: string | boolean;
  auth: {
    enabled: boolean;
    sessionTtlMinutes: number;
    sessionStoragePath?: string;
    oauthCodeTtlMs: number;
    oauthTokenTtlMs: number;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  features: {
    auth: boolean;
    scopeValidation: boolean;
    enhancedSecurity: boolean;
    configReload: boolean;
    envSubstitution: boolean;
    sessionPersistence: boolean;
    clientNotifications: boolean;
  };
  health: {
    detailLevel: 'full' | 'basic' | 'minimal';
  };
  asyncLoading: {
    enabled: boolean;
    notifyOnServerReady: boolean;
    waitForMinimumServers: number;
    initialLoadTimeoutMs: number;
    batchNotifications: boolean;
    batchDelayMs: number;
  };
  configReload: {
    debounceMs: number;
  };
  sessionPersistence: {
    persistRequests: number;
    persistIntervalMinutes: number;
    backgroundFlushSeconds: number;
  };
}

/**
 * AgentConfigManager manages agent-specific configuration settings.
 *
 * This singleton class handles authentication and session configuration
 * that differs from the main MCP server configuration. It provides
 * centralized access to agent settings with default values and
 * runtime configuration updates.
 *
 * @example
 * ```typescript
 * const configManager = AgentConfigManager.getInstance();
 * configManager.updateConfig({
 *   auth: { enabled: true, sessionTtlMinutes: 60 }
 * });
 * ```
 */
export class AgentConfigManager {
  private static instance: AgentConfigManager;
  private config: AgentConfig;

  /**
   * Private constructor to enforce singleton pattern.
   *
   * Initializes the configuration with default values from constants.
   * Should not be called directly - use getInstance() instead.
   */
  private constructor() {
    this.config = {
      host: HOST,
      port: PORT,
      trustProxy: 'loopback',
      auth: {
        enabled: AUTH_CONFIG.SERVER.DEFAULT_ENABLED,
        sessionTtlMinutes: AUTH_CONFIG.SERVER.SESSION.TTL_MINUTES,
        oauthCodeTtlMs: AUTH_CONFIG.SERVER.AUTH_CODE.TTL_MS,
        oauthTokenTtlMs: AUTH_CONFIG.SERVER.TOKEN.TTL_MS,
      },
      rateLimit: {
        windowMs: RATE_LIMIT_CONFIG.OAUTH.WINDOW_MS,
        max: RATE_LIMIT_CONFIG.OAUTH.MAX,
      },
      features: {
        auth: AUTH_CONFIG.SERVER.DEFAULT_ENABLED,
        scopeValidation: AUTH_CONFIG.SERVER.DEFAULT_ENABLED,
        enhancedSecurity: false,
        configReload: true,
        envSubstitution: true,
        sessionPersistence: true,
        clientNotifications: true,
      },
      health: {
        detailLevel: 'minimal',
      },
      asyncLoading: {
        enabled: false, // Default: disabled (opt-in behavior)
        notifyOnServerReady: true,
        waitForMinimumServers: 0,
        initialLoadTimeoutMs: 30000, // 30 seconds
        batchNotifications: true,
        batchDelayMs: 1000, // 1 second
      },
      configReload: {
        debounceMs: 500,
      },
      sessionPersistence: {
        persistRequests: 100,
        persistIntervalMinutes: 5,
        backgroundFlushSeconds: 60,
      },
    };
  }

  /**
   * Gets the singleton instance of AgentConfigManager.
   *
   * Creates a new instance if one doesn't exist, otherwise returns
   * the existing instance to ensure configuration consistency.
   *
   * @returns The singleton AgentConfigManager instance
   */
  public static getInstance(): AgentConfigManager {
    if (!AgentConfigManager.instance) {
      AgentConfigManager.instance = new AgentConfigManager();
    }
    return AgentConfigManager.instance;
  }

  /**
   * Updates the agent configuration with new values.
   *
   * Merges the provided updates with existing configuration, allowing
   * partial updates while preserving other settings.
   *
   * @param updates - Partial configuration object with new values
   */
  public updateConfig(updates: Partial<AgentConfig>): void {
    this.config = deepMerge(this.config, updates);
  }

  /**
   * Gets a copy of the current agent configuration.
   *
   * Returns a deep copy to prevent external modification of the
   * internal configuration state.
   *
   * @returns Current agent configuration
   */
  public getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Generic type-safe getter for accessing configuration properties.
   *
   * Provides type-safe access to any config property with full TypeScript
   * inference. Use this method instead of individual getters for better
   * maintainability and consistency.
   *
   * @param key - The configuration key to access
   * @returns The configuration value with proper typing
   *
   * @example
   * ```typescript
   * const configManager = AgentConfigManager.getInstance();
   *
   * // Access nested properties with full type safety
   * const sessionTtl = configManager.get('auth').sessionTtlMinutes;
   * const rateLimitMax = configManager.get('rateLimit').max;
   * const isAsyncEnabled = configManager.get('asyncLoading').enabled;
   * ```
   */
  public get<K extends keyof AgentConfig>(key: K): AgentConfig[K] {
    return this.config[key];
  }

  // Convenience methods for frequently used properties
  public getUrl(): string {
    return this.get('externalUrl') || `http://${this.get('host')}:${this.get('port')}`;
  }

  public getStreambleHttpUrl(): string {
    return `${this.getUrl()}${STREAMABLE_HTTP_ENDPOINT}`;
  }

  public getTrustProxy(): string | boolean {
    return this.get('trustProxy');
  }

  public isAuthEnabled(): boolean {
    return this.get('features').auth;
  }

  public isAsyncLoadingEnabled(): boolean {
    return this.get('asyncLoading').enabled;
  }

  public isConfigReloadEnabled(): boolean {
    return this.get('features').configReload;
  }

  public isScopeValidationEnabled(): boolean {
    return this.get('features').scopeValidation;
  }

  public isEnhancedSecurityEnabled(): boolean {
    return this.get('features').enhancedSecurity;
  }

  public getHealthDetailLevel(): 'full' | 'basic' | 'minimal' {
    return this.get('health').detailLevel;
  }

  public isClientNotificationsEnabled(): boolean {
    return this.get('features').clientNotifications;
  }

  public getSessionStoragePath(): string | undefined {
    return this.get('auth').sessionStoragePath;
  }

  public getSessionTtlMinutes(): number {
    return this.get('auth').sessionTtlMinutes;
  }

  public getOAuthCodeTtlMs(): number {
    return this.get('auth').oauthCodeTtlMs;
  }

  public getOAuthTokenTtlMs(): number {
    return this.get('auth').oauthTokenTtlMs;
  }

  public getRateLimitWindowMs(): number {
    return this.get('rateLimit').windowMs;
  }

  public getRateLimitMax(): number {
    return this.get('rateLimit').max;
  }

  public isEnvSubstitutionEnabled(): boolean {
    return this.get('features').envSubstitution;
  }

  public getConfigReloadDebounceMs(): number {
    return this.get('configReload').debounceMs;
  }

  public isBatchNotificationsEnabled(): boolean {
    return this.get('asyncLoading').batchNotifications;
  }

  public getBatchDelayMs(): number {
    return this.get('asyncLoading').batchDelayMs;
  }

  public isNotifyOnServerReadyEnabled(): boolean {
    return this.get('asyncLoading').notifyOnServerReady;
  }

  public isSessionPersistenceEnabled(): boolean {
    return this.get('features').sessionPersistence;
  }

  public getSessionPersistRequests(): number {
    return this.get('sessionPersistence').persistRequests;
  }

  public getSessionPersistIntervalMinutes(): number {
    return this.get('sessionPersistence').persistIntervalMinutes;
  }

  public getSessionBackgroundFlushSeconds(): number {
    return this.get('sessionPersistence').backgroundFlushSeconds;
  }
}
