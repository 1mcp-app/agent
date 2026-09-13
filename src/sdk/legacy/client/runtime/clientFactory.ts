import { Client as ModernClient, type VersionNegotiationMode } from '@modelcontextprotocol/client';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { MCP_CLIENT_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { CustomJsonSchemaValidator } from '@src/core/validation/CustomJsonSchemaValidator.js';
import { captureJson } from '@src/core/validation/schemaPolicy.js';
import type { ClientCapabilities } from '@src/sdk/legacy/types.js';

import type { AuthProviderTransport, OutboundProtocolVersion } from './legacyTransport.js';
import type { OutboundSdkClient } from './sdkClient.js';

const DEBOUNCED_NOTIFICATION_METHODS = [
  'notifications/tools/list_changed',
  'notifications/resources/list_changed',
  'notifications/prompts/list_changed',
] as const;

const advertisedProfiles = new WeakMap<OutboundSdkClient, Readonly<ClientCapabilities>>();

/** Unknown clients provide no proof about the capabilities used at initialize. */
export function getAdvertisedClientCapabilities(client: OutboundSdkClient): Readonly<ClientCapabilities> | undefined {
  return advertisedProfiles.get(client);
}

function recordProfile<T extends OutboundSdkClient>(client: T, profile: ClientCapabilities): T {
  advertisedProfiles.set(client, profile);
  const register = client.registerCapabilities.bind(client);
  client.registerCapabilities = (additional: ClientCapabilities) => {
    register(additional as never);
    // A public capability mutation invalidates constructor evidence; never infer an empty profile.
    advertisedProfiles.delete(client);
  };
  return client;
}

export class ClientFactory {
  public createClient(
    transport?: AuthProviderTransport,
    capabilities: ClientCapabilities = MCP_CLIENT_CAPABILITIES,
  ): OutboundSdkClient {
    capabilities = captureJson(capabilities, false).value as ClientCapabilities;
    if (transport) {
      const setProtocolVersion = transport.setProtocolVersion?.bind(transport);
      transport.setProtocolVersion = (revision: string) => {
        transport.negotiatedProtocolRevision = revision;
        setProtocolVersion?.(revision);
      };
    }
    const protocolVersion = transport?.outboundProtocolVersion;
    if (protocolVersion && protocolVersion !== 'legacy') {
      return this.createModernClient(protocolVersion, transport, capabilities);
    }

    const customValidator = new CustomJsonSchemaValidator();

    return recordProfile(
      new Client(
        {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
        {
          capabilities,
          jsonSchemaValidator: customValidator,
          debouncedNotificationMethods: [...DEBOUNCED_NOTIFICATION_METHODS],
        },
      ),
      capabilities,
    );
  }

  private createModernClient(
    protocolVersion: Exclude<OutboundProtocolVersion, 'legacy'>,
    transport: AuthProviderTransport,
    capabilities: ClientCapabilities,
  ): ModernClient {
    const mode: VersionNegotiationMode = protocolVersion === 'auto' ? 'auto' : { pin: protocolVersion };
    const configuredTimeout = transport.connectionTimeout ?? transport.timeout;
    const probeTimeout = configuredTimeout && configuredTimeout > 0 ? configuredTimeout : 5_000;

    return recordProfile(
      new ModernClient(
        {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
        {
          capabilities: capabilities as never,
          versionNegotiation: {
            mode,
            probe: { timeoutMs: probeTimeout, maxRetries: 0 },
          },
        },
      ),
      capabilities,
    );
  }

  public createClientInstance(): Client {
    const capabilities = captureJson({}, false).value as ClientCapabilities;
    return recordProfile(
      new Client(
        {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
        { capabilities, jsonSchemaValidator: new CustomJsonSchemaValidator() },
      ),
      capabilities,
    );
  }

  public createPooledClientInstance(): Client {
    const capabilities = captureJson({}, false).value as ClientCapabilities;
    return recordProfile(
      new Client(
        {
          name: '1mcp-client',
          version: '1.0.0',
        },
        {
          capabilities,
          jsonSchemaValidator: new CustomJsonSchemaValidator(),
        },
      ),
      capabilities,
    );
  }
}
