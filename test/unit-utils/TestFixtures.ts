import { ClientSessionData } from '@src/auth/sessionTypes.js';

/**
 * Standard test data fixtures for consistent testing
 */
export class TestFixtures {
  /**
   * Standard server configuration for testing
   */
  static readonly SERVER_CONFIG = {
    name: 'test-server',
    command: 'node',
    args: ['test-server.js'],
    cwd: '/tmp',
    env: {},
  };

  /**
   * Alternative server configuration for multi-server tests
   */
  static readonly SERVER_CONFIG_ALT = {
    name: 'alt-server',
    command: 'python',
    args: ['alt-server.py'],
    cwd: '/tmp',
    env: { PYTHONPATH: '/usr/local/lib/python3.9/site-packages' },
  };

  /**
   * Standard MCP configuration for testing
   */
  static readonly MCP_CONFIG = {
    mcpServers: {
      'test-server': TestFixtures.SERVER_CONFIG,
    },
  };

  /**
   * MCP configuration with multiple servers
   */
  static readonly MCP_CONFIG_MULTI = {
    mcpServers: {
      'test-server': TestFixtures.SERVER_CONFIG,
      'alt-server': TestFixtures.SERVER_CONFIG_ALT,
    },
  };

  /**
   * Standard client session data for testing
   */
  static readonly CLIENT_SESSION_DATA: ClientSessionData = {
    serverName: 'test-server',
    clientInfo: JSON.stringify({
      client_id: 'test-client-123',
      client_secret: 'secret-value',
      redirect_uris: ['https://app.com/callback'],
    }),
    tokens: JSON.stringify({
      access_token: 'access-token-123',
      refresh_token: 'refresh-token-456',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read write',
    }),
    createdAt: Date.now(),
    expires: Date.now() + 3600000,
  };

  /**
   * Expired client session data for testing
   */
  static readonly CLIENT_SESSION_DATA_EXPIRED: ClientSessionData = {
    ...TestFixtures.CLIENT_SESSION_DATA,
    tokens: JSON.stringify({
      access_token: 'expired-token-123',
      refresh_token: 'expired-refresh-456',
      token_type: 'Bearer',
      expires_in: -3600, // Expired
      scope: 'read write',
    }),
  };

  /**
   * Standard test client information
   */
  static readonly CLIENT_INFO = {
    client_id: 'test-client-123',
    client_secret: 'secret-value',
    redirect_uris: ['https://app.com/callback'],
    scope: 'read write',
    grant_types: ['authorization_code', 'refresh_token'],
  };

  /**
   * Standard test token data
   */
  static readonly TOKEN_DATA = {
    access_token: 'access-token-123',
    refresh_token: 'refresh-token-456',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'read write',
  };

  /**
   * Standard test user data
   */
  static readonly USER_DATA = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    scope: 'read write',
  };

  /**
   * Standard test error responses
   */
  static readonly ERROR_RESPONSES = {
    INVALID_CLIENT: {
      error: 'invalid_client',
      error_description: 'Client authentication failed',
    },
    INVALID_GRANT: {
      error: 'invalid_grant',
      error_description: 'The provided authorization grant is invalid',
    },
    INVALID_REQUEST: {
      error: 'invalid_request',
      error_description: 'The request is missing a required parameter',
    },
    UNAUTHORIZED_CLIENT: {
      error: 'unauthorized_client',
      error_description: 'The client is not authorized to request a token',
    },
    UNSUPPORTED_GRANT_TYPE: {
      error: 'unsupported_grant_type',
      error_description: 'The authorization grant type is not supported',
    },
  };

  /**
   * Standard test MCP protocol messages
   */
  static readonly MCP_MESSAGES = {
    INITIALIZE_REQUEST: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: false,
          },
          sampling: {},
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    },
    INITIALIZE_RESULT: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          logging: {},
          prompts: {
            listChanged: false,
          },
          resources: {
            subscribe: false,
            listChanged: false,
          },
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'test-server',
          version: '1.0.0',
        },
      },
    },
    PING_REQUEST: {
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
    },
    PING_RESULT: {
      jsonrpc: '2.0',
      id: 2,
      result: {},
    },
    TOOLS_LIST_REQUEST: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    },
    TOOLS_LIST_RESULT: {
      jsonrpc: '2.0',
      id: 3,
      result: {
        tools: [
          {
            name: 'test-tool',
            description: 'A test tool',
            inputSchema: {
              type: 'object',
              properties: {
                input: {
                  type: 'string',
                  description: 'Test input',
                },
              },
              required: ['input'],
            },
          },
        ],
      },
    },
  };

  /**
   * Standard test HTTP headers
   */
  static readonly HTTP_HEADERS = {
    JSON: {
      'Content-Type': 'application/json',
    },
    FORM: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    AUTHORIZATION: {
      Authorization: 'Bearer access-token-123',
    },
  };

  /**
   * Standard test environment variables
   */
  static readonly ENV_VARS = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    TEST_MODE: 'true',
    MCP_CONFIG_PATH: '/tmp/test-config.json',
  };

  /**
   * Standard test file paths
   */
  static readonly FILE_PATHS = {
    CONFIG: '/tmp/test-config.json',
    TEMP_DIR: '/tmp/mcp-test',
    LOG_FILE: '/tmp/test.log',
    CLIENT_DATA: '/tmp/client-data.json',
    SESSION_DATA: '/tmp/session-data.json',
  };

  /**
   * Utility method to create a deep copy of any fixture
   */
  static clone<T>(fixture: T): T {
    return JSON.parse(JSON.stringify(fixture));
  }

  /**
   * Utility method to merge fixtures with overrides
   */
  static merge<T>(base: T, overrides: Partial<T>): T {
    return { ...TestFixtures.clone(base), ...overrides };
  }

  /**
   * Create a server config with custom overrides
   */
  static createServerConfig(overrides: any = {}): any {
    return TestFixtures.merge(TestFixtures.SERVER_CONFIG, overrides);
  }

  /**
   * Create an MCP config with custom overrides
   */
  static createMcpConfig(overrides: any = {}): any {
    return TestFixtures.merge(TestFixtures.MCP_CONFIG, overrides);
  }

  /**
   * Create client session data with custom overrides
   */
  static createClientSessionData(overrides: Partial<ClientSessionData> = {}): ClientSessionData {
    return TestFixtures.merge(TestFixtures.CLIENT_SESSION_DATA, overrides);
  }

  /**
   * Create a unique server name for testing
   */
  static createUniqueServerName(): string {
    return `test-server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a unique client ID for testing
   */
  static createUniqueClientId(): string {
    return `test-client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a unique session ID for testing
   */
  static createUniqueSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
