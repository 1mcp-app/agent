import { IOType } from 'node:child_process';
import { Stream } from 'node:stream';

import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { z } from 'zod';

/**
 * Enhanced transport interface that includes MCP-specific properties
 *
 * Timeout Precedence Hierarchy:
 * - Connection timeout: connectionTimeout > timeout (deprecated)
 * - Request timeout: requestTimeout > timeout (deprecated)
 *
 * When both specific and deprecated timeouts are set, specific timeouts take precedence.
 */
export interface EnhancedTransport extends Transport {
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
  readonly tags?: string[];
  readonly oauth?: OAuthConfig;
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
  url: z.string().url().optional().describe('URL for HTTP or SSE transport'),
  headers: z.record(z.string(), z.string()).optional().describe('Custom HTTP headers to send with requests'),

  // StdioServerParameters fields
  command: z.string().optional().describe('Command to execute for stdio transport'),
  args: z.array(z.string()).optional().describe('Command-line arguments for the command'),
  stderr: z
    .union([z.string(), z.number()])
    .optional()
    .describe('How to handle stderr output (inherit, ignore, pipe, or file descriptor)'),
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
  restartOnExit: z.boolean().optional().describe('Automatically restart the server if it exits'),
  maxRestarts: z.number().min(0).optional().describe('Maximum number of restart attempts (0 = unlimited)'),
  restartDelay: z.number().min(0).optional().describe('Delay in milliseconds before restarting'),

  // Tool/Resource/Prompt filtering
  /**
   * List of tool names to exclude from this server.
   * Use this to hide specific tools you don't want exposed to AI assistants.
   */
  disabledTools: z.array(z.string()).optional().describe('List of tool names to disable for this server'),
  /**
   * List of tool names to include from this server.
   * When specified, only these tools will be available (inverse of disabledTools).
   * Useful for whitelisting specific tools when a server provides many tools.
   */
  enabledTools: z.array(z.string()).optional().describe('List of tool names to enable for this server (only these tools will be available)'),
  /**
   * List of resource URIs to exclude from this server.
   */
  disabledResources: z.array(z.string()).optional().describe('List of resource URIs to disable for this server'),
  /**
   * List of resource URIs to include from this server.
   */
  enabledResources: z.array(z.string()).optional().describe('List of resource URIs to enable for this server (only these resources will be available)'),
  /**
   * List of prompt names to exclude from this server.
   */
  disabledPrompts: z.array(z.string()).optional().describe('List of prompt names to disable for this server'),
  /**
   * List of prompt names to include from this server.
   */
  enabledPrompts: z.array(z.string()).optional().describe('List of prompt names to enable for this server (only these prompts will be available)'),

  // Template configuration
  template: templateServerConfigSchema.optional().describe('Template-based server instance management configuration'),
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
  /** Static server configurations (no template processing) */
  mcpServers: Record<string, MCPServerParams>;
  /** Template-based server configurations (processed with context) */
  mcpTemplates?: Record<string, MCPServerParams>;
  /** Template processing settings */
  templateSettings?: TemplateSettings;
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

/**
 * Extended Zod schema for MCP server configuration with template support
 */
export const mcpServerConfigSchema = z.object({
  version: z.string().optional().describe('Version of the configuration format for migration purposes'),
  mcpServers: z
    .record(z.string(), transportConfigSchema)
    .describe('Static server configurations (no template processing)'),
  mcpTemplates: z
    .record(z.string(), transportConfigSchema)
    .optional()
    .describe('Template-based server configurations (processed with context data)'),
  templateSettings: templateSettingsSchema.optional().describe('Template processing settings'),
});

/**
 * Type for MCP server configuration derived from the extended schema
 */
export type MCPServerConfigType = z.infer<typeof mcpServerConfigSchema>;
