import { Client as ModernClient } from '@modelcontextprotocol/client';

import type { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';

export type OutboundSdkClient = LegacyClient | ModernClient;

export function isModernSdkClient(client: OutboundSdkClient): client is ModernClient {
  return client instanceof ModernClient;
}
