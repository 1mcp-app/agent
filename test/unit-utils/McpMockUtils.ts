import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequest,
  CallToolResult,
  GetPromptRequest,
  GetPromptResult,
  InitializeRequest,
  InitializeResult,
  JSONRPCError,
  JSONRPCRequest,
  ListPromptsRequest,
  ListPromptsResult,
  ListResourcesRequest,
  ListResourcesResult,
  ListToolsRequest,
  ListToolsResult,
  ReadResourceRequest,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';

import { vi } from 'vitest';

import { TestFixtures } from './TestFixtures.js';

/**
 * MCP-specific mock utilities for testing MCP protocol interactions
 */
export class McpMockUtils {
  /**
   * Create a mock MCP client with common methods
   */
  static createMockMcpClient(overrides?: Partial<Client>): Partial<Client> {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({}),
      notification: vi.fn().mockResolvedValue(undefined),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      ...overrides,
    };

    // Setup common request handlers
    mockClient.request = vi.fn().mockImplementation((request: JSONRPCRequest) => {
      switch (request.method) {
        case 'initialize':
          return Promise.resolve(TestFixtures.MCP_MESSAGES.INITIALIZE_RESULT.result);
        case 'ping':
          return Promise.resolve({});
        case 'tools/list':
          return Promise.resolve(TestFixtures.MCP_MESSAGES.TOOLS_LIST_RESULT.result);
        default:
          return Promise.resolve({});
      }
    });

    return mockClient;
  }

  /**
   * Create a mock MCP server with common methods
   */
  static createMockMcpServer(overrides?: Partial<Server>): Partial<Server> {
    const mockServer = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({}),
      notification: vi.fn().mockResolvedValue(undefined),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      ...overrides,
    };

    // Setup common request handlers
    mockServer.request = vi.fn().mockImplementation((request: JSONRPCRequest) => {
      switch (request.method) {
        case 'initialize':
          return Promise.resolve(TestFixtures.MCP_MESSAGES.INITIALIZE_RESULT.result);
        case 'ping':
          return Promise.resolve({});
        case 'tools/list':
          return Promise.resolve(TestFixtures.MCP_MESSAGES.TOOLS_LIST_RESULT.result);
        default:
          return Promise.resolve({});
      }
    });

    return mockServer;
  }

  /**
   * Create a mock MCP transport with protocol support
   */
  static createMockMcpTransport(overrides?: Partial<Transport>): Transport {
    const mockTransport = {
      name: 'test-transport',
      start: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    } as Transport;

    // Setup message handling
    let messageHandler: ((message: any) => void) | undefined;
    let errorHandler: ((error: Error) => void) | undefined;
    let closeHandler: (() => void) | undefined;

    mockTransport.onmessage = vi.fn();
    mockTransport.onerror = vi.fn();
    mockTransport.onclose = vi.fn();

    // Add helper methods to simulate events
    (mockTransport as any).simulateMessage = (message: any) => {
      if (messageHandler) {
        messageHandler(message);
      }
    };

    (mockTransport as any).simulateError = (error: Error) => {
      if (errorHandler) {
        errorHandler(error);
      }
    };

    (mockTransport as any).simulateClose = () => {
      if (closeHandler) {
        closeHandler();
      }
    };

    return mockTransport;
  }

  /**
   * Create a mock JSON-RPC request
   */
  static createMockRequest(method: string, params?: any, id?: string | number): JSONRPCRequest {
    return {
      jsonrpc: '2.0',
      method,
      params,
      id: id ?? Math.floor(Math.random() * 1000),
    };
  }

  /**
   * Create a mock JSON-RPC response
   */
  static createMockResponse(id: string | number, result?: any, error?: JSONRPCError): any {
    if (error) {
      return {
        jsonrpc: '2.0',
        id: id,
        error: error,
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: id,
        result: result ?? {},
      };
    }
  }

  /**
   * Create a mock JSON-RPC error
   */
  static createMockError(code: number, message: string, data?: any): any {
    return {
      code,
      message,
      data,
    };
  }

  /**
   * Create a mock initialize request
   */
  static createMockInitializeRequest(): InitializeRequest {
    return TestFixtures.MCP_MESSAGES.INITIALIZE_REQUEST as InitializeRequest;
  }

  /**
   * Create a mock initialize result
   */
  static createMockInitializeResult(): InitializeResult {
    return TestFixtures.MCP_MESSAGES.INITIALIZE_RESULT.result as InitializeResult;
  }

  /**
   * Create a mock tools list request
   */
  static createMockToolsListRequest(): ListToolsRequest {
    return TestFixtures.MCP_MESSAGES.TOOLS_LIST_REQUEST as ListToolsRequest;
  }

  /**
   * Create a mock tools list result
   */
  static createMockToolsListResult(): ListToolsResult {
    return TestFixtures.MCP_MESSAGES.TOOLS_LIST_RESULT.result as ListToolsResult;
  }

  /**
   * Create a mock call tool request
   */
  static createMockCallToolRequest(toolName: string = 'test-tool', arguments_?: any): CallToolRequest {
    return {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: arguments_ ?? { input: 'test input' },
      },
    } as CallToolRequest;
  }

  /**
   * Create a mock call tool result
   */
  static createMockCallToolResult(content?: any, isError: boolean = false): CallToolResult {
    return {
      content: content ?? [
        {
          type: 'text',
          text: 'Tool executed successfully',
        },
      ],
      isError,
    };
  }

  /**
   * Create a mock list resources request
   */
  static createMockListResourcesRequest(): ListResourcesRequest {
    return {
      method: 'resources/list',
    } as ListResourcesRequest;
  }

  /**
   * Create a mock list resources result
   */
  static createMockListResourcesResult(): ListResourcesResult {
    return {
      resources: [
        {
          uri: 'file:///test-resource.txt',
          name: 'Test Resource',
          description: 'A test resource',
          mimeType: 'text/plain',
        },
      ],
    };
  }

  /**
   * Create a mock read resource request
   */
  static createMockReadResourceRequest(uri: string = 'file:///test-resource.txt'): ReadResourceRequest {
    return {
      method: 'resources/read',
      params: {
        uri,
      },
    } as ReadResourceRequest;
  }

  /**
   * Create a mock read resource result
   */
  static createMockReadResourceResult(content?: string): ReadResourceResult {
    return {
      contents: [
        {
          uri: 'file:///test-resource.txt',
          mimeType: 'text/plain',
          text: content ?? 'Test resource content',
        },
      ],
    };
  }

  /**
   * Create a mock list prompts request
   */
  static createMockListPromptsRequest(): ListPromptsRequest {
    return {
      method: 'prompts/list',
    } as ListPromptsRequest;
  }

  /**
   * Create a mock list prompts result
   */
  static createMockListPromptsResult(): ListPromptsResult {
    return {
      prompts: [
        {
          name: 'test-prompt',
          description: 'A test prompt',
          arguments: [
            {
              name: 'input',
              description: 'Input for the prompt',
              required: true,
            },
          ],
        },
      ],
    };
  }

  /**
   * Create a mock get prompt request
   */
  static createMockGetPromptRequest(name: string = 'test-prompt', arguments_?: any): GetPromptRequest {
    return {
      method: 'prompts/get',
      params: {
        name,
        arguments: arguments_ ?? { input: 'test input' },
      },
    } as GetPromptRequest;
  }

  /**
   * Create a mock get prompt result
   */
  static createMockGetPromptResult(description?: string): GetPromptResult {
    return {
      description: description ?? 'Test prompt result',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Test prompt message',
          },
        },
      ],
    };
  }

  /**
   * Create a mock MCP client with protocol simulation
   */
  static createProtocolSimulatingClient(): {
    client: Partial<Client>;
    simulateInitialize: () => Promise<InitializeResult>;
    simulateToolsList: () => Promise<ListToolsResult>;
    simulateToolCall: (toolName: string, args?: any) => Promise<CallToolResult>;
    simulateResourcesList: () => Promise<ListResourcesResult>;
    simulateResourceRead: (uri: string) => Promise<ReadResourceResult>;
    simulatePromptsList: () => Promise<ListPromptsResult>;
    simulatePromptGet: (name: string, args?: any) => Promise<GetPromptResult>;
    simulateError: (method: string, error: JSONRPCError) => void;
  } {
    const client = McpMockUtils.createMockMcpClient();
    const requestHandlers = new Map<string, (params: any) => Promise<any>>();

    // Override the request method to use handlers
    client.request = vi.fn().mockImplementation((request: JSONRPCRequest) => {
      const handler = requestHandlers.get(request.method);
      if (handler) {
        return handler(request.params);
      }
      return Promise.resolve({});
    });

    return {
      client,
      simulateInitialize: async () => {
        const result = McpMockUtils.createMockInitializeResult();
        requestHandlers.set('initialize', async () => result);
        return result;
      },
      simulateToolsList: async () => {
        const result = McpMockUtils.createMockToolsListResult();
        requestHandlers.set('tools/list', async () => result);
        return result;
      },
      simulateToolCall: async (toolName: string, _args?: any) => {
        const result = McpMockUtils.createMockCallToolResult();
        requestHandlers.set('tools/call', async (params) => {
          if (params.name === toolName) {
            return result;
          }
          throw McpMockUtils.createMockError(-32601, 'Tool not found');
        });
        return result;
      },
      simulateResourcesList: async () => {
        const result = McpMockUtils.createMockListResourcesResult();
        requestHandlers.set('resources/list', async () => result);
        return result;
      },
      simulateResourceRead: async (uri: string) => {
        const result = McpMockUtils.createMockReadResourceResult();
        requestHandlers.set('resources/read', async (params) => {
          if (params.uri === uri) {
            return result;
          }
          throw McpMockUtils.createMockError(-32602, 'Resource not found');
        });
        return result;
      },
      simulatePromptsList: async () => {
        const result = McpMockUtils.createMockListPromptsResult();
        requestHandlers.set('prompts/list', async () => result);
        return result;
      },
      simulatePromptGet: async (name: string, _args?: any) => {
        const result = McpMockUtils.createMockGetPromptResult();
        requestHandlers.set('prompts/get', async (params) => {
          if (params.name === name) {
            return result;
          }
          throw McpMockUtils.createMockError(-32602, 'Prompt not found');
        });
        return result;
      },
      simulateError: (method: string, error: JSONRPCError) => {
        requestHandlers.set(method, async () => {
          throw error;
        });
      },
    };
  }

  /**
   * Create a mock MCP server with protocol simulation
   */
  static createProtocolSimulatingServer(): {
    server: Partial<Server>;
    simulateClientRequest: (method: string, params?: any) => Promise<void>;
    simulateClientNotification: (method: string, params?: any) => Promise<void>;
    getRequestHandler: (method: string) => any;
    getNotificationHandler: (method: string) => any;
  } {
    const server = McpMockUtils.createMockMcpServer();
    const requestHandlers = new Map<string, (params: any) => Promise<any>>();
    const notificationHandlers = new Map<string, (params: any) => Promise<void>>();

    // Override handler registration methods
    server.setRequestHandler = vi.fn().mockImplementation((method: string, handler: any) => {
      requestHandlers.set(method, handler);
    });

    server.setNotificationHandler = vi.fn().mockImplementation((method: string, handler: any) => {
      notificationHandlers.set(method, handler);
    });

    return {
      server,
      simulateClientRequest: async (method: string, params?: any) => {
        const handler = requestHandlers.get(method);
        if (handler) {
          await handler(params);
        }
      },
      simulateClientNotification: async (method: string, params?: any) => {
        const handler = notificationHandlers.get(method);
        if (handler) {
          await handler(params);
        }
      },
      getRequestHandler: (method: string) => requestHandlers.get(method),
      getNotificationHandler: (method: string) => notificationHandlers.get(method),
    };
  }

  /**
   * Common MCP protocol error codes
   */
  static readonly ERROR_CODES = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    SERVER_ERROR: -32000,
  };

  /**
   * Create standard MCP protocol errors
   */
  static createStandardErrors() {
    return {
      parseError: (data?: any) =>
        McpMockUtils.createMockError(McpMockUtils.ERROR_CODES.PARSE_ERROR, 'Parse error', data),
      invalidRequest: (data?: any) =>
        McpMockUtils.createMockError(McpMockUtils.ERROR_CODES.INVALID_REQUEST, 'Invalid Request', data),
      methodNotFound: (data?: any) =>
        McpMockUtils.createMockError(McpMockUtils.ERROR_CODES.METHOD_NOT_FOUND, 'Method not found', data),
      invalidParams: (data?: any) =>
        McpMockUtils.createMockError(McpMockUtils.ERROR_CODES.INVALID_PARAMS, 'Invalid params', data),
      internalError: (data?: any) =>
        McpMockUtils.createMockError(McpMockUtils.ERROR_CODES.INTERNAL_ERROR, 'Internal error', data),
      serverError: (data?: any) =>
        McpMockUtils.createMockError(McpMockUtils.ERROR_CODES.SERVER_ERROR, 'Server error', data),
    };
  }
}
