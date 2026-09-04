import type { SDKOAuthClientProvider } from '@src/auth/sdkOAuthClientProvider.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';

export type OutboundProtocolVersion = 'auto' | 'legacy' | '2026-07-28';

export interface RecreateTransportOptions {
  readonly preserveSessionId?: boolean;
}

export interface AuthProviderTransport extends Transport {
  /** 1MCP-owned outbound mode; absent transports retain legacy compatibility. */
  outboundProtocolVersion?: OutboundProtocolVersion;
  /** Rebuilds from the configured backend rather than copying live transport state. */
  recreate?: (options?: RecreateTransportOptions) => AuthProviderTransport;
  connectionTimeout?: number;
  requestTimeout?: number;
  timeout?: number;
  tags?: string[];
  oauthProvider?: SDKOAuthClientProvider;
  stdioSupervision?: {
    readonly policy: {
      readonly restartOnExit: true;
      readonly maxRestarts?: number;
      readonly restartDelay?: number;
    };
    readonly recreate: () => AuthProviderTransport;
    readonly getLastExit: () => {
      code: number | null;
      signal: string | null;
      pid: number | null;
      at: Date;
    } | null;
  };
}
