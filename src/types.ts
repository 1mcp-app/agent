import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

/**
 * Enhanced transport interface that includes MCP-specific properties
 */
export interface EnhancedTransport extends Transport {
  timeout?: number;
  tags?: string[];
}

/**
 * Base interface for common transport properties
 */
export interface BaseTransportConfig {
  readonly timeout?: number;
  readonly disabled?: boolean;
  readonly tags?: string[];
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
  readonly stderr?: string | number;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

/**
 * Zod schema for transport configuration
 */
export const transportConfigSchema = z.object({
  type: z.enum(['stdio', 'sse', 'http']).optional(),
  disabled: z.boolean().optional(),
  timeout: z.number().optional(),
  tags: z.array(z.string()).optional(),

  // HTTP/SSE Parameters
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),

  // StdioServerParameters fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  stderr: z.union([z.string(), z.number()]).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
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
 * Server information including tags
 */
export interface ServerInfo {
  readonly server: Server;
  readonly tags?: string[];
}

/**
 * Enum representing possible client connection states
 */
export enum ClientStatus {
  /** Client is successfully connected */
  Connected = 'connected',
  /** Client is disconnected */
  Disconnected = 'disconnected',
  /** Client encountered an error */
  Error = 'error',
}

/**
 * Complete client information including transport, status and history
 */
export interface ClientInfo {
  readonly name: string;
  readonly transport: EnhancedTransport;
  readonly client: Client;
  readonly status: ClientStatus;
  readonly lastError?: Error;
  readonly lastConnected?: Date;
  capabilities?: ServerCapabilities;
}

/**
 * Map of client information indexed by client name
 */
export type Clients = Record<string, ClientInfo>;

/**
 * Options for client operations
 */
export interface OperationOptions {
  readonly retryCount?: number;
  readonly retryDelay?: number;
}
