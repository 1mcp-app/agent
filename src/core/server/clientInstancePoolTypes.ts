import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { BackendStdioSupervisor, BackendSupervisionSnapshot } from '@src/core/server/backendStdioSupervisor.js';
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
  /** @deprecated Cleanup is owned by TemplateServerManager. */
  cleanupInterval?: number;
  /** Maximum total instances across all templates */
  maxTotalInstances?: number;
}

export interface TemplateInstancePoolPolicy {
  maxInstancesPerTemplate: number;
  maxTotalInstances: number;
  idleTimeoutMs: number;
  cleanupIntervalMs: number;
}

export const DEFAULT_TEMPLATE_INSTANCE_POOL_POLICY: TemplateInstancePoolPolicy = {
  maxInstancesPerTemplate: 50,
  maxTotalInstances: 100,
  idleTimeoutMs: 5 * 60 * 1000,
  cleanupIntervalMs: 30 * 1000,
};

/**
 * Default pool configuration
 */
export const DEFAULT_POOL_OPTIONS: ClientPoolOptions = {
  maxInstances: DEFAULT_TEMPLATE_INSTANCE_POOL_POLICY.maxInstancesPerTemplate,
  idleTimeout: DEFAULT_TEMPLATE_INSTANCE_POOL_POLICY.idleTimeoutMs,
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
  /** Keyed fingerprint of the effective configuration after Runtime Scope substitution. */
  runtimeFingerprint: string;
  /** Processed server configuration */
  processedConfig: MCPServerParams;
  /** Number of clients currently connected to this instance */
  referenceCount: number;
  /** Timestamp when this instance was created */
  createdAt: Date;
  /** Timestamp of last client activity */
  lastUsedAt: Date;
  /** Current status of the instance */
  status: 'active' | 'idle' | 'restarting' | 'crash-loop' | 'terminating';
  /** Runtime-owned stdio supervision state for this logical instance. */
  supervisor?: BackendStdioSupervisor;
  supervision?: BackendSupervisionSnapshot;
  /** Routable outbound connection keys currently backed by this logical instance. */
  outboundKeys: Set<string>;
  /** Set of client IDs connected to this instance */
  clientIds: Set<string>;
  /** Template-specific idle timeout */
  idleTimeout: number;
}
