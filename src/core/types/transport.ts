import { IOType } from 'node:child_process';
import { Stream } from 'node:stream';

import { z } from 'zod';

const ENVIRONMENT_REFERENCE_PATTERN = /\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/u;
const transportUrlSchema = z.union([
  z.string().url(),
  z.string().regex(ENVIRONMENT_REFERENCE_PATTERN, 'URL must be a valid URL or environment substitution reference.'),
]);

/**
 * Enhanced transport interface that includes MCP-specific properties
 *
 * Timeout Precedence Hierarchy:
 * - Connection timeout: connectionTimeout > timeout (deprecated)
 * - Request timeout: requestTimeout > timeout (deprecated)
 *
 * When both specific and deprecated timeouts are set, specific timeouts take precedence.
 */
export interface EnhancedTransport {
  /**
   * Timeout for establishing initial connection (in milliseconds)
   * Used when calling client.connect(transport, {timeout})
   *
   * Takes precedence over the deprecated `timeout` field for connection operations.
   */
  connectionTimeout?: number;

  /**
   * Timeout for individual request operations (in milliseconds)
   * Used for callTool, readResource, and other MCP operations
   *
   * Takes precedence over the deprecated `timeout` field for request operations.
   */
  requestTimeout?: number;

  /**
   * @deprecated Use connectionTimeout and requestTimeout instead
   * Fallback timeout value used for both connection and requests when specific timeouts are not set
   *
   * This field is maintained for backward compatibility. New code should use
   * connectionTimeout for connection operations and requestTimeout for request operations.
   */
  timeout?: number;

  tags?: string[];

}

/**
 * OAuth client configuration for connecting to downstream MCP servers
 */
export interface OAuthConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly scopes?: string[];
  readonly autoRegister?: boolean;
  readonly redirectUrl?: string;
}

/**
 * Base interface for common transport properties
 */
export interface BaseTransportConfig {
  /** @deprecated Use connectionTimeout and requestTimeout instead */
  readonly timeout?: number;
  readonly connectionTimeout?: number;
  readonly requestTimeout?: number;
  /** Disable this server. Can be a boolean or a template string that evaluates to a boolean */
  readonly disabled?: boolean | string;
  /** Hide specific tools from this server without disabling the entire server */
  readonly disabledTools?: string[];
  /** Literal replacement for upstream server instructions. Empty intentionally suppresses them. */
  readonly instructionOverride?: string;
  /** Replace upstream tool descriptions by logical tool name */
  readonly toolDescriptionOverrides?: Record<string, string>;
  readonly tags?: string[];
  readonly oauth?: OAuthConfig;
}

/**
 * Shareable transport settings that can be defined globally and inherited by servers
 */
export interface GlobalTransportConfig {
  readonly env?: Record<string, string> | string[];
  /** @deprecated Use connectionTimeout and requestTimeout instead */
  readonly timeout?: number;
  readonly connectionTimeout?: number;
  readonly requestTimeout?: number;
  readonly oauth?: OAuthConfig;
  readonly headers?: Record<string, string>;
  readonly inheritParentEnv?: boolean;
  readonly envFilter?: string[];
  readonly restartOnExit?: boolean;
  readonly maxRestarts?: number;
  readonly restartDelay?: number;
}

/**
 * Application-level configuration that can be set in mcp.json under the "app" key.
 * CLI args and ONE_MCP_* env vars always take precedence over these values.
 */
export interface ApplicationConfig {
  readonly transport?: 'http' | 'sse' | 'stdio';
  readonly port?: number;
  readonly host?: string;
  /** @deprecated Use `logging.level`. Kept as an alias for backward compatibility. */
  readonly logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** @deprecated Use `logging.file`. Kept as an alias for backward compatibility. */
  readonly logFile?: string;
  /**
   * Structured logging configuration. Supersedes the flat `logLevel`/`logFile`
   * keys and adds size-based rotation (`maxSize`/`maxFiles`).
   */
  readonly logging?: {
    readonly file?: string;
    readonly level?: 'debug' | 'info' | 'warn' | 'error';
    /** Max size before rotation: bytes (number) or a string like "10m"/"1g". */
    readonly maxSize?: number | string;
    /** Max number of rotated files to retain. */
    readonly maxFiles?: number;
  };
  readonly auth?: {
    readonly enabled?: boolean;
    readonly sessionTtl?: number;
    readonly rateLimitWindow?: number;
    readonly rateLimitMax?: number;
    readonly trustProxy?: string;
    readonly enableScopeValidation?: boolean;
    readonly enableEnhancedSecurity?: boolean;
  };
  readonly asyncLoading?: {
    readonly enabled?: boolean;
    /** @deprecated Compatibility no-op; remove before the next breaking release. */
    readonly minServers?: number;
    /** @deprecated Compatibility no-op; remove before the next breaking release. */
    readonly timeout?: number;
    readonly batchNotifications?: boolean;
    readonly batchDelay?: number;
    readonly maxConcurrentLoads?: number;
    readonly maxRetries?: number;
    readonly retryDelay?: number;
    readonly backgroundRetry?: {
      readonly enabled?: boolean;
      readonly interval?: number;
      readonly maxServersPerCycle?: number;
    };
  };
  readonly lazyLoading?: {
    readonly enabled?: boolean;
    readonly mode?: 'full' | 'metatool' | 'hybrid';
    readonly cacheMaxEntries?: number;
    readonly inlineCatalog?: boolean;
  };
  readonly configReload?: {
    readonly enabled?: boolean;
    readonly debounce?: number;
  };
  readonly admin?: {
    readonly enabled?: boolean;
    readonly rateLimit?: {
      readonly login?: {
        readonly windowSeconds?: number;
        readonly maxRequests?: number;
        readonly maxFailedAttempts?: number;
      };
      readonly status?: {
        readonly windowSeconds?: number;
        readonly maxRequests?: number;
      };
      readonly sensitive?: {
        readonly windowSeconds?: number;
        readonly maxRequests?: number;
      };
    };
    readonly audit?: {
      readonly retentionDays?: number;
    };
  };
  readonly health?: {
    readonly rateLimit?: {
      readonly windowSeconds?: number;
      readonly maxRequests?: number;
    };
  };
  readonly templateSettings?: {
    readonly pool?: {
      readonly maxInstancesPerTemplate?: number;
      readonly maxTotalInstances?: number;
      readonly idleTimeout?: number;
      readonly cleanupInterval?: number;
    };
  };
  readonly templateContext?: {
    readonly trust?: 'verified' | 'disabled' | 'legacy';
  };
}

/**
 * Common configuration for HTTP-based transports (HTTP and SSE)
 */
export interface HTTPBasedTransportConfig extends BaseTransportConfig {
  readonly type: 'http' | 'sse';
  readonly url: string;
  readonly headers?: Record<string, string>;
}

/**
 * Stdio transport specific configuration
 */
export interface StdioTransportConfig extends BaseTransportConfig {
  readonly type: 'stdio';
  readonly command: string;
  readonly args?: string[];
  readonly stderr?: IOType | Stream | number;
  readonly cwd?: string;
  readonly env?: Record<string, string> | string[];
  readonly inheritParentEnv?: boolean;
  readonly envFilter?: string[];
  readonly restartOnExit?: boolean;
  readonly maxRestarts?: number;
  readonly restartDelay?: number;
}

/**
 * Zod schema for OAuth configuration
 */
export const oAuthConfigSchema = z.object({
  clientId: z.string().optional().describe('OAuth client ID for authentication'),
  clientSecret: z.string().optional().describe('OAuth client secret for authentication'),
  scopes: z.array(z.string()).optional().describe('OAuth scopes to request'),
  autoRegister: z.boolean().optional().describe('Automatically register OAuth client if not already registered'),
  redirectUrl: z.string().optional().describe('OAuth redirect URL used after auth'),
});

/**
 * Zod schema for template server configuration
 */
export const templateServerConfigSchema = z.object({
  shareable: z.boolean().optional().describe('Whether this template creates shareable server instances'),
  maxInstances: z.number().min(0).optional().describe('Maximum instances per template (0 = unlimited)'),
  idleTimeout: z.number().min(0).optional().describe('Idle timeout before termination in milliseconds'),
  perClient: z.boolean().optional().describe('Force per-client instances (overrides shareable)'),
  extractionOptions: z
    .object({
      includeOptional: z.boolean().optional().describe('Whether to include optional variables in the result'),
      includeEnvironment: z.boolean().optional().describe('Whether to include environment variables'),
    })
    .optional()
    .describe('Default options for variable extraction'),
});

/**
 * Zod schema for transport configuration
 */
export const transportConfigSchema = z.object({
  type: z
    .enum(['stdio', 'sse', 'http', 'streamableHttp'])
    .optional()
    .describe('Transport type for connecting to the MCP server'),
  disabled: z
    .union([z.boolean(), z.string()])
    .optional()
    .describe(
      'Disable this server. Can be a boolean value or a template string that evaluates to a boolean (e.g., "{?project.environment=production}")',
    ),
  disabledTools: z
    .array(z.string().min(1))
    .optional()
    .describe('Hide specific tools from this server without disabling the entire server'),
  instructionOverride: z
    .string()
    .optional()
    .describe('Literal replacement for upstream instructions; an empty string intentionally suppresses them'),
  toolDescriptionOverrides: z
    .record(
      z
        .string()
        .min(1)
        .refine((name) => name === name.trim()),
      z.string().regex(/\S/u).trim().min(1),
    )
    .optional()
    .describe('Override upstream tool descriptions by logical tool name; blank descriptions are not supported'),
  timeout: z
    .number()
    .optional()
    .describe('Deprecated: Use connectionTimeout and requestTimeout instead. Fallback timeout in milliseconds'),
  connectionTimeout: z
    .number()
    .optional()
    .describe('Timeout for establishing initial connection in milliseconds (takes precedence over timeout)'),
  requestTimeout: z
    .number()
    .optional()
    .describe('Timeout for individual request operations in milliseconds (takes precedence over timeout)'),
  tags: z.array(z.string()).optional().describe('Tags for filtering and organizing servers'),
  oauth: oAuthConfigSchema.optional().describe('OAuth configuration for authentication'),

  // HTTP/SSE Parameters
  url: transportUrlSchema.optional().describe('URL for HTTP or SSE transport'),
  headers: z.record(z.string(), z.string()).optional().describe('Custom HTTP headers to send with requests'),

  // StdioServerParameters fields
  command: z.string().optional().describe('Command to execute for stdio transport'),
  args: z.array(z.string()).optional().describe('Command-line arguments for the command'),
  stderr: z
    .union([z.enum(['inherit', 'ignore', 'overlapped', 'pipe']), z.number().int().min(0)])
    .optional()
    .describe('How to handle stderr output (inherit, ignore, overlapped, pipe, or file descriptor)'),
  cwd: z.string().optional().describe('Working directory for the command'),
  env: z
    .union([z.record(z.string(), z.string()), z.array(z.string())])
    .optional()
    .describe('Environment variables as object or array of KEY=VALUE strings'),
  inheritParentEnv: z.boolean().optional().describe('Whether to inherit environment variables from parent process'),
  envFilter: z
    .array(z.string())
    .optional()
    .describe('List of environment variable names to include when inheritParentEnv is true'),
  restartOnExit: z
    .boolean()
    .optional()
    .describe('Enable runtime-owned automatic restart after an unexpected stdio backend exit'),
  maxRestarts: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Maximum consecutive restart attempts (omitted = 5, 0 = unlimited; resets after 5 stable minutes)'),
  restartDelay: z
    .number()
    .min(0)
    .optional()
    .describe('Initial restart delay in milliseconds (omitted = 1000; backoff is 1x, 2x, 4x, 8x, then 16x)'),

  // Template configuration
  template: templateServerConfigSchema.optional().describe('Template-based server instance management configuration'),
});

/**
 * Zod schema for application-level configuration
 */
export const applicationConfigSchema = z.object({
  transport: z.enum(['http', 'sse', 'stdio']).optional().describe('Transport type for the 1MCP server'),
  port: z.number().int().min(1).max(65535).optional().describe('HTTP port to listen on'),
  host: z.string().optional().describe('HTTP host to listen on'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional().describe('Deprecated: use logging.level'),
  logFile: z.string().optional().describe('Deprecated: use logging.file'),
  logging: z
    .object({
      file: z.string().optional().describe('Path to log file'),
      level: z.enum(['debug', 'info', 'warn', 'error']).optional().describe('Log level'),
      maxSize: z
        .union([
          z.number().int().positive(),
          // Mirror the grammar parseByteSize() accepts (loggingConfig.ts) so an
          // invalid size is rejected at the config boundary instead of silently
          // degrading to `undefined` and disabling rotation later.
          z
            .string()
            .trim()
            .regex(/^\d+(?:\.\d+)?\s*([kmg])?b?$/i, 'Expected a byte size like "10m" or "1g"'),
        ])
        .optional()
        .describe('Max log file size before rotation: bytes (number) or a string like "10m"/"1g"'),
      maxFiles: z.number().int().positive().optional().describe('Max number of rotated log files to retain'),
    })
    .optional()
    .describe('Structured logging configuration with size-based rotation'),
  auth: z
    .object({
      enabled: z.boolean().optional().describe('Enable OAuth 2.1 authentication'),
      sessionTtl: z.number().int().min(1).optional().describe('Session TTL in minutes'),
      rateLimitWindow: z.number().int().min(1).optional().describe('Rate limit window in minutes'),
      rateLimitMax: z.number().int().min(1).optional().describe('Maximum requests per rate limit window'),
      trustProxy: z.string().optional().describe('Trust proxy configuration for Express.js'),
      enableScopeValidation: z.boolean().optional().describe('Enable tag-based scope validation'),
      enableEnhancedSecurity: z.boolean().optional().describe('Enable enhanced security middleware'),
    })
    .optional(),
  asyncLoading: z
    .object({
      enabled: z.boolean().optional().describe('Enable asynchronous MCP server loading'),
      minServers: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Deprecated compatibility no-op; does not gate listener or request readiness'),
      timeout: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Deprecated compatibility no-op; does not delay async startup'),
      batchNotifications: z
        .boolean()
        .optional()
        .describe('Coalesce capability-change notifications within the batch delay window'),
      batchDelay: z.number().int().min(0).optional().describe('Notification coalescing window in milliseconds'),
      maxConcurrentLoads: z.number().int().positive().optional().describe('Maximum concurrent backend loads'),
      maxRetries: z.number().int().min(0).optional().describe('Maximum foreground retries after the initial attempt'),
      retryDelay: z.number().int().min(0).optional().describe('Initial retry delay in milliseconds'),
      backgroundRetry: z
        .object({
          enabled: z.boolean().optional().describe('Retry failed backends in the background'),
          interval: z.number().int().min(1000).optional().describe('Background retry interval in milliseconds'),
          maxServersPerCycle: z.number().int().positive().optional().describe('Maximum failed backends per cycle'),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  lazyLoading: z
    .object({
      enabled: z.boolean().optional().describe('Enable lazy loading for tools'),
      mode: z.enum(['full', 'metatool', 'hybrid']).optional().describe('Deprecated and ignored lazy loading mode'),
      cacheMaxEntries: z.number().int().min(0).optional().describe('Maximum tool schemas to cache'),
      inlineCatalog: z.boolean().optional().describe('Include full tool catalog in initialize template'),
    })
    .optional(),
  configReload: z
    .object({
      enabled: z.boolean().optional().describe('Enable automatic configuration hot-reload'),
      debounce: z.number().int().min(0).optional().describe('Debounce delay in milliseconds'),
    })
    .optional(),
  admin: z
    .object({
      enabled: z.boolean().optional().describe('Enable Admin Console and CLI Admin Adapter HTTP surfaces'),
      rateLimit: z
        .object({
          login: z
            .object({
              windowSeconds: z.number().int().min(1).max(86400).optional(),
              maxRequests: z.number().int().min(1).max(100000).optional(),
              maxFailedAttempts: z.number().int().min(1).max(100).optional(),
            })
            .strict()
            .optional(),
          status: z
            .object({
              windowSeconds: z.number().int().min(1).max(86400).optional(),
              maxRequests: z.number().int().min(1).max(100000).optional(),
            })
            .strict()
            .optional(),
          sensitive: z
            .object({
              windowSeconds: z.number().int().min(1).max(86400).optional(),
              maxRequests: z.number().int().min(1).max(100000).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
      audit: z
        .object({
          retentionDays: z.number().int().min(1).max(3650).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  health: z
    .object({
      rateLimit: z
        .object({
          windowSeconds: z.number().int().min(1).max(86400).optional(),
          maxRequests: z.number().int().min(1).max(100000).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  templateSettings: z
    .object({
      pool: z
        .object({
          maxInstancesPerTemplate: z.number().int().min(0).max(10000).optional(),
          maxTotalInstances: z.number().int().min(1).max(10000).optional(),
          idleTimeout: z.number().int().min(0).max(2147483647).optional(),
          cleanupInterval: z.number().int().min(1000).max(3600000).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  templateContext: z
    .object({
      trust: z.enum(['verified', 'disabled', 'legacy']).optional().describe('Template context trust policy'),
    })
    .optional(),
});

/**
 * Keys allowed in the global MCP configuration section
 */
export const GLOBAL_TRANSPORT_CONFIG_KEYS = [
  'env',
  'timeout',
  'connectionTimeout',
  'requestTimeout',
  'oauth',
  'headers',
  'inheritParentEnv',
  'envFilter',
  'restartOnExit',
  'maxRestarts',
  'restartDelay',
] as const;

/**
 * Zod schema for global MCP configuration
 * Only includes shareable settings that can be inherited by servers.
 */
export const globalTransportConfigSchema = transportConfigSchema.pick({
  env: true,
  timeout: true,
  connectionTimeout: true,
  requestTimeout: true,
  oauth: true,
  headers: true,
  inheritParentEnv: true,
  envFilter: true,
  restartOnExit: true,
  maxRestarts: true,
  restartDelay: true,
});

/**
 * Union type for all transport configurations
 */
export type TransportConfig = HTTPBasedTransportConfig | StdioTransportConfig;

/**
 * Type for MCP server parameters derived from transport config schema
 */
export type MCPServerParams = z.infer<typeof transportConfigSchema>;

/**
 * Template settings for controlling template processing behavior
 */
export interface TemplateSettings {
  /** Whether to validate templates on configuration reload */
  validateOnReload?: boolean;
  /** How to handle template processing failures */
  failureMode?: 'strict' | 'graceful';
  /** Whether to cache processed templates based on context hash */
  cacheContext?: boolean;
}

/**
 * Configuration for template-based server instance management
 */
export interface TemplateServerConfig {
  /** Whether this template creates shareable server instances */
  shareable?: boolean;
  /** Maximum instances per template (0 = unlimited) */
  maxInstances?: number;
  /** Idle timeout before termination in milliseconds */
  idleTimeout?: number;
  /** Force per-client instances (overrides shareable) */
  perClient?: boolean;
  /** Default options for variable extraction */
  extractionOptions?: {
    /** Whether to include optional variables in the result */
    includeOptional?: boolean;
    /** Whether to include environment variables */
    includeEnvironment?: boolean;
  };
}

/**
 * Extended MCP server configuration that supports both static and template-based servers
 */
export interface MCPServerConfiguration {
  /** Version of the configuration format for migration purposes */
  version?: string;
  /** Shareable defaults inherited by all MCP servers (transport settings only) */
  serverDefaults?: GlobalTransportConfig;
  /** Static server configurations (no template processing) */
  mcpServers: Record<string, MCPServerParams>;
  /** Template-based server configurations (processed with context) */
  mcpTemplates?: Record<string, MCPServerParams>;
  /** Template processing settings */
  templateSettings?: TemplateSettings;
  /** Managed, surface-specific instruction template drafts keyed by stable identity. */
  instructionTemplates?: Record<string, InstructionTemplateConfig>;
  /** Last explicitly activated variants, kept separate from editable drafts. */
  publishedInstructionTemplates?: Record<string, InstructionTemplateConfig>;
  /** Explicitly selected managed instruction template identity, including the protected `default`. */
  activeInstructionTemplate?: string;
}

export interface InstructionTemplateConfig {
  initialization: string;
  cli: string;
}

/**
 * Zod schema for template settings
 */
export const templateSettingsSchema = z.object({
  validateOnReload: z.boolean().optional().describe('Whether to validate templates on configuration reload'),
  failureMode: z
    .enum(['strict', 'graceful'])
    .optional()
    .describe('How to handle template processing failures (strict = throw error, graceful = log and continue)'),
  cacheContext: z.boolean().optional().describe('Whether to cache processed templates based on context hash'),
});

export const instructionTemplateConfigSchema = z.object({
  initialization: z.string().describe('Complete Handlebars template for MCP initialization instructions'),
  cli: z.string().describe('Complete Handlebars template for direct CLI instructions'),
});

/**
 * Extended Zod schema for MCP server configuration with template support
 */
export const mcpServerConfigSchema = z
  .object({
    version: z.string().optional().describe('Version of the configuration format for migration purposes'),
    serverDefaults: globalTransportConfigSchema
      .optional()
      .describe('Shareable defaults inherited by all MCP servers (transport settings only)'),
    mcpServers: z
      .record(z.string(), transportConfigSchema)
      .describe('Static server configurations (no template processing)'),
    mcpTemplates: z
      .record(z.string(), transportConfigSchema)
      .optional()
      .describe('Template-based server configurations (processed with context data)'),
    templateSettings: templateSettingsSchema.optional().describe('Template processing settings'),
    instructionTemplates: z
      .record(z.string().min(1), instructionTemplateConfigSchema)
      .optional()
      .describe('Managed instruction template drafts keyed by stable identity'),
    publishedInstructionTemplates: z
      .record(z.string().min(1), instructionTemplateConfigSchema)
      .optional()
      .describe('Last activated instruction template variants keyed by stable identity'),
    activeInstructionTemplate: z
      .string()
      .min(1)
      .optional()
      .describe('Explicitly selected managed instruction template identity'),
  })
  .superRefine((config, context) => {
    if (config.instructionTemplates && Object.hasOwn(config.instructionTemplates, 'default')) {
      context.addIssue({
        code: 'custom',
        path: ['instructionTemplates', 'default'],
        message: 'The protected default instruction template cannot be redefined',
      });
    }

    if (config.publishedInstructionTemplates && Object.hasOwn(config.publishedInstructionTemplates, 'default')) {
      context.addIssue({
        code: 'custom',
        path: ['publishedInstructionTemplates', 'default'],
        message: 'The protected default instruction template cannot be published',
      });
    }

    if (
      config.activeInstructionTemplate !== undefined &&
      config.activeInstructionTemplate !== 'default' &&
      !Object.hasOwn(config.instructionTemplates ?? {}, config.activeInstructionTemplate)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['activeInstructionTemplate'],
        message: 'Active instruction template must reference a managed template or the protected default',
      });
    }
  });

/**
 * Type for MCP server configuration derived from the extended schema
 */
export type MCPServerConfigType = z.infer<typeof mcpServerConfigSchema>;
