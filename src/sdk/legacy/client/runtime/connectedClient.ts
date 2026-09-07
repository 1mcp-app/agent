import type { AuthProviderTransport } from './legacyTransport.js';
import type { OutboundSdkClient } from './sdkClient.js';

export interface ConnectedClient {
  readonly client: OutboundSdkClient;
  readonly transport: AuthProviderTransport;
}
