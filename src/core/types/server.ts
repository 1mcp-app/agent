import type { LegacyConnectionId, LegacySdkAdapter } from '@src/sdk/contracts/legacySdkAdapter.js';

import type { TemplateContextProof } from '@src/core/context/templateContextTrust.js';
import { TemplateConfig } from '@src/core/instructions/templateTypes.js';
import { TagExpression } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import { ContextNamespace, EnvironmentContext, UserContext } from '@src/types/context.js';

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

export type InboundConnectionAdapter = Pick<
  LegacySdkAdapter,
  'connectionId' | 'state' | 'start' | 'notify' | 'close'
>;

export interface InboundConnectionError {
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
}

export interface InboundConnectionConfig extends TemplateConfig {
  readonly tags?: string[];
  readonly tagExpression?: TagExpression;
  readonly tagQuery?: TagQuery;
  readonly tagFilterMode?: 'simple-or' | 'advanced' | 'preset' | 'none';
  readonly enablePagination?: boolean;
  readonly presetName?: string;
  readonly context?: {
    project?: ContextNamespace;
    user?: UserContext;
    environment?: EnvironmentContext;
    timestamp?: string;
    version?: string;
    sessionId?: string;
    transport?: {
      type: string;
      connectionId?: string;
      connectionTimestamp?: string;
      client?: {
        name: string;
        version: string;
        title?: string;
      };
    };
  };
  readonly contextProof?: TemplateContextProof;
}

/**
 * SDK-free inbound connection snapshot and its opaque legacy adapter.
 */
export interface InboundConnection extends InboundConnectionConfig {
  readonly connectionId: LegacyConnectionId;
  readonly adapter: InboundConnectionAdapter;
  readonly status: ServerStatus;
  readonly lastError?: InboundConnectionError;
  readonly lastConnected?: string;
  readonly connectedAt?: string;
}

export type ServerCapability = 'completions' | 'experimental' | 'logging' | 'prompts' | 'resources' | 'tools';
