import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { AuthProviderTransport } from '@src/core/types/index.js';
import type { MCPServerParams } from '@src/core/types/transport.js';

/**
 * Configuration options for client instance pool
 */
export interface ClientPoolOptions {
  /** Maximum number of instances per template (0 = unlimited) */
  maxInstances?: number;
  /** Time in milliseconds to wait before terminating idle instances */
  idleTimeout?: number;
  /** Interval in milliseconds to run cleanup checks */
  cleanupInterval?: number;
  /** Maximum total instances across all templates (0 = unlimited) */
  maxTotalInstances?: number;
}

/**
 * Default pool configuration
 */
export const DEFAULT_POOL_OPTIONS: ClientPoolOptions = {
  maxInstances: 10,
  idleTimeout: 5 * 60 * 1000,
  cleanupInterval: 60 * 1000,
  maxTotalInstances: 100,
};

/**
 * Represents a pooled client instance connected to an upstream MCP server
 */
export interface PooledClientInstance {
  /** Unique identifier for this instance */
  id: string;
  /** Internal pool key used to address this instance */
  instanceKey: string;
  /** Name of the template this instance was created from */
  templateName: string;
  /** MCP client instance */
  client: Client;
  /** Transport connected to upstream server */
  transport: AuthProviderTransport;
  /** Hash of the rendered configuration used to create this instance */
  renderedHash: string;
  /** Processed server configuration */
  processedConfig: MCPServerParams;
  /** Number of clients currently connected to this instance */
  referenceCount: number;
  /** Timestamp when this instance was created */
  createdAt: Date;
  /** Timestamp of last client activity */
  lastUsedAt: Date;
  /** Current status of the instance */
  status: 'active' | 'idle' | 'terminating';
  /** Set of client IDs connected to this instance */
  clientIds: Set<string>;
  /** Template-specific idle timeout */
  idleTimeout: number;
}
