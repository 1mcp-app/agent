import { AUTH_CONFIG, HOST, PORT, RATE_LIMIT_CONFIG } from '../../constants.js';

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
    // Handle nested object merging properly
    const { auth, rateLimit, features, health, asyncLoading, ...otherUpdates } = updates;

    this.config = { ...this.config, ...otherUpdates };

    if (auth) {
      this.config.auth = { ...this.config.auth, ...auth };
    }
    if (rateLimit) {
      this.config.rateLimit = { ...this.config.rateLimit, ...rateLimit };
    }
    if (features) {
      this.config.features = { ...this.config.features, ...features };
    }
    if (health) {
      this.config.health = { ...this.config.health, ...health };
    }
    if (asyncLoading) {
      this.config.asyncLoading = { ...this.config.asyncLoading, ...asyncLoading };
    }
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
   * Checks if authentication is currently enabled.
   *
   * @returns True if OAuth 2.1 authentication is enabled, false otherwise
   */
  public isAuthEnabled(): boolean {
    return this.config.features.auth;
  }

  /**
   * Gets the session time-to-live in minutes.
   *
   * @returns Session TTL in minutes
   */
  public getSessionTtlMinutes(): number {
    return this.config.auth.sessionTtlMinutes;
  }

  /**
   * Gets the custom session storage path if configured.
   *
   * @returns Custom session storage path or undefined if using default
   */
  public getSessionStoragePath(): string | undefined {
    return this.config.auth.sessionStoragePath;
  }

  /**
   * Gets the OAuth authorization code time-to-live in milliseconds.
   *
   * @returns OAuth code TTL in milliseconds
   */
  public getOAuthCodeTtlMs(): number {
    return this.config.auth.oauthCodeTtlMs;
  }

  /**
   * Gets the OAuth access token time-to-live in milliseconds.
   *
   * @returns OAuth token TTL in milliseconds
   */
  public getOAuthTokenTtlMs(): number {
    return this.config.auth.oauthTokenTtlMs;
  }

  /**
   * Gets the rate limit window in milliseconds.
   *
   * @returns Rate limit window in milliseconds
   */
  public getRateLimitWindowMs(): number {
    return this.config.rateLimit.windowMs;
  }

  /**
   * Gets the maximum number of requests per rate limit window.
   *
   * @returns Maximum requests per window
   */
  public getRateLimitMax(): number {
    return this.config.rateLimit.max;
  }

  /**
   * Checks if scope validation is enabled.
   *
   * @returns True if tag-based scope validation is enabled, false otherwise
   */
  public isScopeValidationEnabled(): boolean {
    return this.config.features.scopeValidation;
  }

  /**
   * Checks if enhanced security middleware is enabled.
   *
   * @returns True if enhanced security middleware is enabled, false otherwise
   */
  public isEnhancedSecurityEnabled(): boolean {
    return this.config.features.enhancedSecurity;
  }

  /**
   * Gets the external URL if configured.
   *
   * @returns The external URL or undefined if not set
   */
  public getExternalUrl(): string | undefined {
    return this.config.externalUrl;
  }

  /**
   * Gets the trust proxy configuration for Express.js.
   *
   * @returns Trust proxy setting (boolean, string preset, IP address, or CIDR range)
   */
  public getTrustProxy(): string | boolean {
    return this.config.trustProxy;
  }

  /**
   * Gets the server URL, preferring external URL if set, otherwise falling back to http://host:port/mcp.
   *
   * @returns The server URL to use for OAuth callbacks and public URLs
   */
  public getUrl(): string {
    const baseUrl = this.config.externalUrl || `http://${this.config.host}:${this.config.port}`;
    return `${baseUrl}/mcp`;
  }

  /**
   * Gets the health endpoint detail level configuration.
   *
   * @returns Health detail level ('full' | 'basic' | 'minimal')
   */
  public getHealthDetailLevel(): 'full' | 'basic' | 'minimal' {
    return this.config.health.detailLevel;
  }

  /**
   * Checks if async loading is enabled.
   *
   * @returns True if MCP servers should load asynchronously, false for legacy synchronous loading
   */
  public isAsyncLoadingEnabled(): boolean {
    return this.config.asyncLoading.enabled;
  }

  /**
   * Checks if server readiness notifications are enabled.
   *
   * @returns True if listChanged notifications should be sent when servers become ready
   */
  public isNotifyOnServerReadyEnabled(): boolean {
    return this.config.asyncLoading.notifyOnServerReady;
  }

  /**
   * Gets the minimum number of servers to wait for during startup.
   *
   * @returns Number of servers to wait for (0 = don't wait)
   */
  public getWaitForMinimumServers(): number {
    return this.config.asyncLoading.waitForMinimumServers;
  }

  /**
   * Gets the initial loading timeout in milliseconds.
   *
   * @returns Maximum time to wait for initial server loading in milliseconds
   */
  public getInitialLoadTimeoutMs(): number {
    return this.config.asyncLoading.initialLoadTimeoutMs;
  }

  /**
   * Checks if notification batching is enabled.
   *
   * @returns True if notifications should be batched to reduce client spam
   */
  public isBatchNotificationsEnabled(): boolean {
    return this.config.asyncLoading.batchNotifications;
  }

  /**
   * Gets the batching delay in milliseconds.
   *
   * @returns Delay before sending batched notifications in milliseconds
   */
  public getBatchDelayMs(): number {
    return this.config.asyncLoading.batchDelayMs;
  }

  /**
   * Gets the complete async loading configuration.
   *
   * @returns Copy of async loading configuration
   */
  public getAsyncLoadingConfig(): AgentConfig['asyncLoading'] {
    return { ...this.config.asyncLoading };
  }
}
