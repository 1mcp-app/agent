/**
 * Management server types
 */
import { MCPServerParams } from '@src/core/types/index.js';

/**
 * Management adapter interface
 */
export interface ManagementAdapter {
  listServers(options?: ManagementListOptions): Promise<ServerInfo[]>;
  getServerStatus(serverName?: string): Promise<ServerStatusInfo>;
  enableServer(serverName: string, options?: EnableServerOptions): Promise<EnableServerResult>;
  disableServer(serverName: string, options?: DisableServerOptions): Promise<DisableServerResult>;
  reloadConfiguration(options?: ReloadOptions): Promise<ReloadResult>;
  updateServerConfig(
    serverName: string,
    config: Partial<MCPServerParams & { newName?: string }>,
  ): Promise<UpdateConfigResult>;
  validateServerConfig(
    serverName: string,
    config: Partial<MCPServerParams & { newName?: string }>,
  ): Promise<ValidationResult>;
  getServerUrl(options?: ServerUrlOptions): Promise<string>;
}

/**
 * Options for getting server URL
 */
export interface ServerUrlOptions {
  port?: number;
  host?: string;
}

/**
 * Server information structure
 */
export interface ServerInfo {
  name: string;
  config: MCPServerParams;
  status: 'enabled' | 'disabled' | 'unknown';
  transport?: 'stdio' | 'sse' | 'http';
  url?: string;
  healthStatus?: 'healthy' | 'unhealthy' | 'unknown';
  lastChecked?: Date;
  metadata?: {
    installedAt?: string;
    version?: string;
    source?: string;
    tags?: string[];
  };
}

/**
 * Server status information
 */
export interface ServerStatusInfo {
  timestamp: string;
  servers: Array<{
    name: string;
    status: 'enabled' | 'disabled' | 'unknown';
    transport?: string;
    url?: string;
    healthStatus?: string;
    lastChecked?: string;
    errors?: string[];
  }>;
  totalServers: number;
  enabledServers: number;
  disabledServers: number;
  unhealthyServers: number;
}

/**
 * Options for listing servers
 */
export interface ManagementListOptions {
  /** Filter by status */
  status?: 'enabled' | 'disabled' | 'all';
  /** Filter by transport type */
  transport?: 'stdio' | 'sse' | 'http';
  /** Include detailed information */
  detailed?: boolean;
  /** Filter by tags */
  tags?: string[];
}

/**
 * Options for enabling servers
 */
export interface EnableServerOptions {
  /** Restart server after enabling */
  restart?: boolean;
  /** Enable only for specific tags */
  tags?: string[];
  /** Enable with grace period */
  graceful?: boolean;
  /** Timeout in seconds */
  timeout?: number;
}

/**
 * Result of enabling a server
 */
export interface EnableServerResult {
  success: boolean;
  serverName: string;
  enabled: boolean;
  restarted?: boolean;
  warnings?: string[];
  errors?: string[];
}

/**
 * Options for disabling servers
 */
export interface DisableServerOptions {
  /** Gracefully shutdown server */
  graceful?: boolean;
  /** Timeout in seconds */
  timeout?: number;
  /** Disable only for specific tags */
  tags?: string[];
  /** Force disable even if in use */
  force?: boolean;
}

/**
 * Result of disabling a server
 */
export interface DisableServerResult {
  success: boolean;
  serverName: string;
  disabled: boolean;
  gracefulShutdown?: boolean;
  warnings?: string[];
  errors?: string[];
}

/**
 * Options for reloading configuration
 */
export interface ReloadOptions {
  /** Reload specific server */
  server?: string;
  /** Reload configuration only (no restart) */
  configOnly?: boolean;
  /** Force reload even if no changes */
  force?: boolean;
  /** Timeout in seconds */
  timeout?: number;
}

/**
 * Result of reload operation
 */
export interface ReloadResult {
  success: boolean;
  target: string;
  action: string;
  timestamp: string;
  reloadedServers?: string[];
  warnings?: string[];
  errors?: string[];
}

/**
 * Configuration change tracking
 */
export interface ConfigChange {
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Result of updating server configuration
 */
export interface UpdateConfigResult {
  success: boolean;
  serverName: string;
  previousConfig: MCPServerParams;
  newConfig: MCPServerParams;
  updated: boolean;
  changes?: ConfigChange[];
  backupPath?: string;
  warnings?: string[];
  errors?: string[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: string[];
}
