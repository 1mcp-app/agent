import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { MCP_CLIENT_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { AuthProviderTransport, ClientStatus, OutboundConnection } from '@src/core/types/index.js';
import { CustomJsonSchemaValidator } from '@src/core/validation/CustomJsonSchemaValidator.js';
import logger from '@src/logger/logger.js';
import { getConnectionTimeout } from '@src/utils/core/timeoutUtils.js';

import { OAuthRequiredError } from './types.js';

const DEBOUNCED_NOTIFICATION_METHODS = [
  'notifications/tools/list_changed',
  'notifications/resources/list_changed',
  'notifications/prompts/list_changed',
] as const;

export class OAuthFlowHandler {
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

  private createClientForOAuth(): Client {
    const customValidator = new CustomJsonSchemaValidator();
    return new Client(
      {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
      {
        capabilities: MCP_CLIENT_CAPABILITIES,
        jsonSchemaValidator: customValidator,
        debouncedNotificationMethods: [...DEBOUNCED_NOTIFICATION_METHODS],
      },
    );
  }

  public handleOAuthRequired(
    name: string,
    transport: AuthProviderTransport,
    _client: Client,
    error: OAuthRequiredError,
  ): OutboundConnection {
    logger.info(`OAuth authorization required for ${name}`);
    const authorizationUrl = this.extractAuthorizationUrl(transport);

    return {
      name,
      transport,
      client: error.client,
      status: ClientStatus.AwaitingOAuth,
      authorizationUrl,
      oauthStartTime: new Date(),
    };
  }

  public async completeOAuthAndReconnect(
    name: string,
    oldTransport: AuthProviderTransport,
    newTransport: AuthProviderTransport,
    authorizationCode: string,
    existingConnection: OutboundConnection,
  ): Promise<OutboundConnection> {
    if (!(oldTransport instanceof StreamableHTTPClientTransport) && !(oldTransport instanceof SSEClientTransport)) {
      throw new Error(`Transport for ${name} does not support OAuth (requires HTTP or SSE transport)`);
    }

    logger.info(`Completing OAuth and reconnecting ${name}...`);

    try {
      await oldTransport.finishAuth(authorizationCode);
      await oldTransport.close();

      const newClient = this.createClientForOAuth();
      const timeout = getConnectionTimeout(newTransport);
      await newClient.connect(newTransport, timeout ? { timeout } : undefined);

      const capabilities = newClient.getServerCapabilities();

      const updatedInfo: OutboundConnection = {
        name,
        transport: newTransport,
        client: newClient,
        status: ClientStatus.Connected,
        lastConnected: new Date(),
        capabilities,
        instructions: existingConnection.instructions,
        lastError: undefined,
      };

      logger.info(`OAuth reconnection completed successfully for ${name}`);
      return updatedInfo;
    } catch (error) {
      logger.error(`OAuth reconnection failed for ${name}:`, error);
      throw error;
    }
  }
}
