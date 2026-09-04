import {
  SSEClientTransport as ModernSSEClientTransport,
  StreamableHTTPClientTransport as ModernStreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { ClientStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { getConnectionTimeout } from '@src/utils/core/timeoutUtils.js';

import { ClientFactory } from './clientFactory.js';
import { createLegacyOutboundConnection, type LegacyOutboundConnection } from './legacyOutboundConnection.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import { isModernSdkClient, type OutboundSdkClient } from './sdkClient.js';
import { OAuthRequiredError } from './types.js';

export class OAuthFlowHandler {
  private readonly clientFactory = new ClientFactory();
  public extractAuthorizationUrl(transport: AuthProviderTransport): string | undefined {
    try {
      const oauthProvider = transport.oauthProvider;
      if (oauthProvider?.getAuthorizationUrl) {
        return oauthProvider.getAuthorizationUrl();
      }
    } catch (error) {
      logger.warn(`Could not extract authorization URL: ${error}`);
    }
    return undefined;
  }

  private createClientForOAuth(transport: AuthProviderTransport): OutboundSdkClient {
    return this.clientFactory.createClient(transport);
  }

  public handleOAuthRequired(
    name: string,
    transport: AuthProviderTransport,
    _client: OutboundSdkClient,
    error: OAuthRequiredError,
  ): LegacyOutboundConnection {
    logger.info(`OAuth authorization required for ${name}`);
    const authorizationUrl = this.extractAuthorizationUrl(transport);

    return createLegacyOutboundConnection({
      name,
      transport,
      client: error.client,
      status: ClientStatus.AwaitingOAuth,
      authorizationUrl,
      oauthStartTime: new Date(),
    });
  }

  public async completeOAuthAndReconnect(
    name: string,
    oldTransport: AuthProviderTransport,
    newTransport: AuthProviderTransport,
    authorizationCode: string,
    existingConnection: LegacyOutboundConnection,
  ): Promise<LegacyOutboundConnection> {
    if (
      !(oldTransport instanceof StreamableHTTPClientTransport) &&
      !(oldTransport instanceof SSEClientTransport) &&
      !(oldTransport instanceof ModernStreamableHTTPClientTransport) &&
      !(oldTransport instanceof ModernSSEClientTransport)
    ) {
      throw new Error(`Transport for ${name} does not support OAuth (requires HTTP or SSE transport)`);
    }

    logger.info(`Completing OAuth and reconnecting ${name}...`);

    try {
      const configuredOldTransport = oldTransport as AuthProviderTransport;
      await (oldTransport as AuthProviderTransport & { finishAuth(code: string): Promise<void> }).finishAuth(
        authorizationCode,
      );
      await oldTransport.close();

      let reconnectTransport = newTransport;
      if (configuredOldTransport.recreate) {
        await newTransport.close().catch(() => undefined);
        reconnectTransport = configuredOldTransport.recreate();
      }
      const newClient = this.createClientForOAuth(reconnectTransport);
      const timeout = getConnectionTimeout(reconnectTransport);
      if (isModernSdkClient(newClient)) {
        await newClient.connect(reconnectTransport as never, timeout ? { timeout } : undefined);
      } else {
        await newClient.connect(reconnectTransport, timeout ? { timeout } : undefined);
      }

      const capabilities = newClient.getServerCapabilities();

      const updatedInfo = createLegacyOutboundConnection({
        name,
        transport: reconnectTransport,
        client: newClient,
        status: ClientStatus.Connected,
        lastConnected: new Date(),
        capabilities,
        instructions: existingConnection.instructions,
      });

      logger.info(`OAuth reconnection completed successfully for ${name}`);
      return updatedInfo;
    } catch (error) {
      logger.error(`OAuth reconnection failed for ${name}:`, error);
      throw error;
    }
  }
}
