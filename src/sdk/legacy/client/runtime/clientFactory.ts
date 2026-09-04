import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { MCP_CLIENT_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { CustomJsonSchemaValidator } from '@src/core/validation/CustomJsonSchemaValidator.js';

const DEBOUNCED_NOTIFICATION_METHODS = [
  'notifications/tools/list_changed',
  'notifications/resources/list_changed',
  'notifications/prompts/list_changed',
] as const;

export class ClientFactory {
  public createClient(): Client {
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
