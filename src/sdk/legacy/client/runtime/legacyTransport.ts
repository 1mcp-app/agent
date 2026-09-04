import type { SDKOAuthClientProvider } from '@src/auth/sdkOAuthClientProvider.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';

export interface AuthProviderTransport extends Transport {
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
