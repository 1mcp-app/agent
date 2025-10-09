#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

class ErrorServer {
  constructor() {
    this.server = new Server(
      {
        name: 'error-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    );

    this.setupHandlers();
  }

  setupHandlers() {
    // Tools that generate different types of errors
    this.server.setRequestHandler({ method: 'tools/list' }, async () => {
      return {
        tools: [
          {
            name: 'invalid_params',
            description: 'Always returns invalid params error',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'method_not_found',
            description: 'Calls non-existent method internally',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'internal_error',
            description: 'Throws internal server error',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'timeout_simulation',
            description: 'Hangs to simulate timeout',
            inputSchema: {
              type: 'object',
              properties: {
                delay: {
                  type: 'number',
                  description: 'Delay in milliseconds',
                },
              },
            },
          },
        ],
      };
    });

    this.server.setRequestHandler({ method: 'tools/call' }, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'invalid_params':
          throw new McpError(ErrorCode.InvalidParams, 'Invalid parameters provided');

        case 'method_not_found':
          throw new McpError(ErrorCode.MethodNotFound, 'The requested method does not exist');

        case 'internal_error':
          throw new McpError(ErrorCode.InternalError, 'An internal server error occurred');

        case 'timeout_simulation': {
          const delay = args?.delay || 30000; // 30 seconds default
          await new Promise((resolve) => setTimeout(resolve, delay));
          return {
            content: [
              {
                type: 'text',
                text: `Delayed response after ${delay}ms`,
              },
            ],
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });

    // Resources that error
    this.server.setRequestHandler({ method: 'resources/list' }, async () => {
      return {
        resources: [
          {
            uri: 'error://not-found',
            name: 'Non-existent Resource',
            description: 'This resource will error when read',
            mimeType: 'text/plain',
          },
          {
            uri: 'error://permission-denied',
            name: 'Permission Denied Resource',
            description: 'This resource simulates permission errors',
            mimeType: 'text/plain',
          },
        ],
      };
    });

    this.server.setRequestHandler({ method: 'resources/read' }, async (request) => {
      const { uri } = request.params;

      if (uri === 'error://not-found') {
        throw new McpError(ErrorCode.InvalidParams, 'Resource not found');
      }

      if (uri === 'error://permission-denied') {
        throw new McpError(ErrorCode.InternalError, 'Permission denied');
      }

      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
    });

    // Custom error methods
    this.server.setRequestHandler({ method: 'error/generate' }, async (request) => {
      const { errorType, message } = request.params || {};

      const errorCode =
        {
          parse: ErrorCode.ParseError,
          invalid_request: ErrorCode.InvalidRequest,
          method_not_found: ErrorCode.MethodNotFound,
          invalid_params: ErrorCode.InvalidParams,
          internal: ErrorCode.InternalError,
        }[errorType] || ErrorCode.InternalError;

      throw new McpError(errorCode, message || 'Generated error');
    });

    // Malformed response handler
    this.server.setRequestHandler({ method: 'error/malformed' }, async () => {
      // This will break JSON-RPC protocol
      return 'This is not a valid JSON-RPC response';
    });

    // Ping handler that sometimes errors
    this.server.setRequestHandler({ method: 'ping' }, async () => {
      // 30% chance of error
      if (Math.random() < 0.3) {
        throw new McpError(ErrorCode.InternalError, 'Random ping failure');
      }
      return { status: 'pong' };
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Handle CLI arguments
const args = process.argv.slice(2);
const config = {};

// Parse simple arguments
args.forEach((arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    config[key] = value || true;
  }
});

const server = new ErrorServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Error server shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Error server terminated');
  process.exit(0);
});

// Disable console logging to avoid interfering with JSON-RPC
if (!config.debug) {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
}

server.run().catch((error) => {
  console.error('Error server error:', error);
  process.exit(1);
});
