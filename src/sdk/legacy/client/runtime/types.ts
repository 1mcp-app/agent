import type { AuthProviderTransport } from './legacyTransport.js';
import type { OutboundSdkClient } from './sdkClient.js';

export class OAuthRequiredError extends Error {
  constructor(
    public serverName: string,
    public client: OutboundSdkClient,
    public transport?: AuthProviderTransport,
  ) {
    super(`OAuth authorization required for ${serverName}`);
    this.name = 'OAuthRequiredError';
  }
}
