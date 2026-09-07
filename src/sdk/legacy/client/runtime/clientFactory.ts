import { Client as ModernClient, type VersionNegotiationMode } from '@modelcontextprotocol/client';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { MCP_CLIENT_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { CustomJsonSchemaValidator } from '@src/core/validation/CustomJsonSchemaValidator.js';

import type { AuthProviderTransport, OutboundProtocolVersion } from './legacyTransport.js';
import type { OutboundSdkClient } from './sdkClient.js';

const DEBOUNCED_NOTIFICATION_METHODS = [
  'notifications/tools/list_changed',
  'notifications/resources/list_changed',
  'notifications/prompts/list_changed',
] as const;

export class ClientFactory {
  public createClient(transport?: AuthProviderTransport): OutboundSdkClient {
    const protocolVersion = transport?.outboundProtocolVersion;
    if (protocolVersion && protocolVersion !== 'legacy') {
      return this.createModernClient(protocolVersion, transport);
    }

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

  private createModernClient(
    protocolVersion: Exclude<OutboundProtocolVersion, 'legacy'>,
    transport: AuthProviderTransport,
  ): ModernClient {
    const mode: VersionNegotiationMode = protocolVersion === 'auto' ? 'auto' : { pin: protocolVersion };
    const configuredTimeout = transport.connectionTimeout ?? transport.timeout;
    const probeTimeout = configuredTimeout && configuredTimeout > 0 ? configuredTimeout : 5_000;

    return new ModernClient(
      {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
      {
        capabilities: MCP_CLIENT_CAPABILITIES as never,
        versionNegotiation: {
          mode,
          probe: { timeoutMs: probeTimeout, maxRetries: 0 },
        },
      },
    );
  }

  public createClientInstance(): Client {
    return new Client(
      {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
      undefined,
    );
  }

  public createPooledClientInstance(): Client {
    return new Client(
      {
        name: '1mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );
  }
}
