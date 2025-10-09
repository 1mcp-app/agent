import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

import { TemplateConfig } from '@src/core/instructions/templateTypes.js';
import { TagQuery } from '@src/utils/config/presetTypes.js';
import { TagExpression } from '@src/utils/parsing/tagQueryParser.js';

/**
 * Enum representing possible server connection states
 */
export enum ServerStatus {
  /** Server is currently connecting */
  Connecting = 'connecting',
  /** Server is successfully connected */
  Connected = 'connected',
  /** Server is disconnected */
  Disconnected = 'disconnected',
  /** Server encountered an error */
  Error = 'error',
}

export interface InboundConnectionConfig extends TemplateConfig {
  readonly tags?: string[];
  readonly tagExpression?: TagExpression;
  readonly tagQuery?: TagQuery;
  readonly tagFilterMode?: 'simple-or' | 'advanced' | 'preset' | 'none';
  readonly enablePagination?: boolean;
  readonly presetName?: string;
}

/**
 * Inbound connection information including server instance and configuration
 */
export interface InboundConnection extends InboundConnectionConfig {
  readonly server: Server;
  status: ServerStatus;
  lastError?: Error;
  lastConnected?: Date;
  connectedAt?: Date;
}

export type ServerCapability = keyof ServerCapabilities;
