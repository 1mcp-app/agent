import type {
  InstallOptions,
  ListOptions,
  UninstallOptions,
  UpdateOptions,
} from '@src/domains/server-management/types.js';

/**
 * Installation adapter interface
 */
export interface InstallationAdapter {
  installServer(
    serverName: string,
    version?: string,
    options?: InstallAdapterOptions,
  ): Promise<{
    success: boolean;
    serverName: string;
    version?: string;
    installedAt: Date;
    configPath?: string;
    backupPath?: string;
    warnings: string[];
    errors: string[];
    operationId: string;
  }>;
  uninstallServer(
    serverName: string,
    options?: UninstallAdapterOptions,
  ): Promise<{
    success: boolean;
    serverName: string;
    removedAt: Date;
    configRemoved: boolean;
    warnings: string[];
    errors: string[];
    operationId: string;
  }>;
  updateServer(
    serverName: string,
    version?: string,
    options?: UpdateAdapterOptions,
  ): Promise<{
    success: boolean;
    serverName: string;
    previousVersion: string;
    newVersion: string;
    updatedAt: Date;
    warnings: string[];
    errors: string[];
    operationId: string;
  }>;
  listInstalledServers(options?: ListAdapterOptions): Promise<string[]>;
  validateTags(tags: string[]): { valid: boolean; errors: string[] };
  parseTags(tagsString: string): string[];
}

/**
 * Adapter-specific options that extend domain service options
 */
export interface InstallAdapterOptions extends Omit<InstallOptions, 'force' | 'backup'> {
  /** Force installation even if server exists */
  force?: boolean;
  /** Create backup before installation */
  backup?: boolean;
  /** Tags to assign to the server */
  tags?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Command line arguments */
  args?: string[];
  /** Package name (npm, pypi, or docker image) */
  package?: string;
  /** Command to run for stdio transport */
  command?: string;
  /** URL for HTTP/SSE transport */
  url?: string;
  /** Transport type */
  transport?: 'stdio' | 'http' | 'sse';
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Enable server after installation */
  enabled?: boolean;
  /** Working directory for stdio servers */
  cwd?: string;
  /** Auto-restart server if it crashes */
  autoRestart?: boolean;
  /** Maximum number of restart attempts */
  maxRestarts?: number;
  /** Delay in milliseconds between restart attempts */
  restartDelay?: number;
}

export interface UninstallAdapterOptions extends Omit<UninstallOptions, 'force' | 'backup'> {
  /** Force uninstallation */
  force?: boolean;
  /** Create backup before uninstallation */
  backup?: boolean;
  /** Remove all configuration files */
  removeAll?: boolean;
}

export interface UpdateAdapterOptions extends Omit<UpdateOptions, 'force' | 'backup'> {
  /** Force update */
  force?: boolean;
  /** Create backup before update */
  backup?: boolean;
  /** Check for updates without applying */
  dryRun?: boolean;
}

export interface ListAdapterOptions extends ListOptions {
  /** Filter servers by tags */
  tags?: string[];
  /** Show detailed information */
  detailed?: boolean;
}
