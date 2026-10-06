import {
  SSEClientTransport as ModernSSEClientTransport,
  StreamableHTTPClientTransport as ModernStreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { parseTemplateConnectionKey } from '@src/core/server/templateIdentity.js';
import { ClientStatus } from '@src/core/types/index.js';
import { writeLocalDiagnostic } from '@src/logger/localDiagnostics.js';
import logger from '@src/logger/logger.js';
import { getConnectionTimeout } from '@src/utils/core/timeoutUtils.js';

import { ClientFactory } from './clientFactory.js';
import { createLegacyOutboundConnection, type LegacyOutboundConnection } from './legacyOutboundConnection.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import { isModernSdkClient, type OutboundSdkClient } from './sdkClient.js';
import { OAuthRequiredError } from './types.js';

function diagnosticServerName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const identity = parseTemplateConnectionKey(name);
  return identity.kind === 'invalid' ? undefined : identity.templateName;
}

export class OAuthFlowHandler {
  private readonly clientFactory = new ClientFactory();
  public extractAuthorizationUrl(transport: AuthProviderTransport, serverName?: string): string | undefined {
    try {
      const oauthProvider = transport.oauthProvider;
      if (oauthProvider?.getAuthorizationUrl) {
        return oauthProvider.getAuthorizationUrl();
      }
    } catch (_error) {
      logger.warn('oauthFlowHandler.could.not.extract.authorization.url.f9cc0cc9', { error: _error });
      writeLocalDiagnostic('warn', 'oauth.authorization.url.extraction.failed', () => ({
        serverName: diagnosticServerName(serverName),
        transportType: transport.constructor.name,
        error: _error,
      }));
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
    logger.info('oauthFlowHandler.oauth.authorization.required.for.b495d670');
    writeLocalDiagnostic('info', 'oauth.authorization.required', () => ({
      serverName: diagnosticServerName(name),
      transportType: transport.constructor.name,
    }));
    const authorizationUrl = this.extractAuthorizationUrl(transport, name);

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
    authorizationCode: string | URLSearchParams,
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

    logger.info('oauthFlowHandler.completing.oauth.and.reconnecting.053f0a15');
    writeLocalDiagnostic('info', 'oauth.reconnection.started', () => ({
      serverName: diagnosticServerName(name),
      transportType: newTransport.constructor.name,
      connectionTimeoutMs: getConnectionTimeout(newTransport),
    }));

    try {
      const configuredOldTransport = oldTransport as AuthProviderTransport;
      const callback =
        typeof authorizationCode === 'string' ? new URLSearchParams({ code: authorizationCode }) : authorizationCode;
      const finish = async () => {
        if (
          oldTransport instanceof ModernStreamableHTTPClientTransport ||
          oldTransport instanceof ModernSSEClientTransport
        ) {
          await oldTransport.finishAuth(callback);
        } else {
          const code = callback.get('code');
          if (!code) throw new Error('Missing authorization code');
          await oldTransport.finishAuth(code);
        }
      };
      const provider = configuredOldTransport.oauthProvider;
      if (!provider) throw new Error('OAuth authorization provider is unavailable');
      await provider.withAuthorizationCallback(callback, finish);
      await oldTransport.close();

      let reconnectTransport = newTransport;
      if (configuredOldTransport.recreate) {
        await newTransport.close().catch(() => undefined);
        reconnectTransport = configuredOldTransport.recreate({ preserveSessionId: false });
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

      logger.info('oauthFlowHandler.oauth.reconnection.completed.successfully.for.65c16552');
      writeLocalDiagnostic('info', 'oauth.reconnection.connected', () => ({
        serverName: diagnosticServerName(name),
        transportType: reconnectTransport.constructor.name,
        connectionTimeoutMs: timeout,
      }));
      return updatedInfo;
    } catch (error) {
      logger.error('oauthFlowHandler.oauth.reconnection.failed.for.4dd2fa2f');
      writeLocalDiagnostic('error', 'oauth.reconnection.failed', () => ({
        serverName: diagnosticServerName(name),
        transportType: newTransport.constructor.name,
        error,
      }));
      throw error;
    }
  }
}
