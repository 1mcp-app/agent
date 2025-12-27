import { Client } from '@modelcontextprotocol/sdk/client/index.js';

export class OAuthRequiredError extends Error {
  constructor(
    public serverName: string,
    public client: Client,
  ) {
    super(`OAuth authorization required for ${serverName}`);
    this.name = 'OAuthRequiredError';
  }
}
