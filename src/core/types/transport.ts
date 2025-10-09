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
  readonly disabled?: boolean;
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
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  autoRegister: z.boolean().optional(),
});

/**
 * Zod schema for transport configuration
 */
export const transportConfigSchema = z.object({
  type: z.enum(['stdio', 'sse', 'http', 'streamableHttp']).optional(),
  disabled: z.boolean().optional(),
  timeout: z.number().optional(), // Deprecated: use connectionTimeout and requestTimeout
  connectionTimeout: z.number().optional(),
  requestTimeout: z.number().optional(),
  tags: z.array(z.string()).optional(),
  oauth: oAuthConfigSchema.optional(),

  // HTTP/SSE Parameters
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),

  // StdioServerParameters fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  stderr: z.union([z.string(), z.number()]).optional(), // Note: IOType validation is complex, keeping simple validation
  cwd: z.string().optional(),
  env: z.union([z.record(z.string(), z.string()), z.array(z.string())]).optional(),
  inheritParentEnv: z.boolean().optional(),
  envFilter: z.array(z.string()).optional(),
  restartOnExit: z.boolean().optional(),
  maxRestarts: z.number().min(0).optional(),
  restartDelay: z.number().min(0).optional(),
});

/**
 * Union type for all transport configurations
 */
export type TransportConfig = HTTPBasedTransportConfig | StdioTransportConfig;

/**
 * Type for MCP server parameters derived from transport config schema
 */
export type MCPServerParams = z.infer<typeof transportConfigSchema>;
