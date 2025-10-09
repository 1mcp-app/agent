#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

class EchoServer {
  constructor() {
    this.server = new Server(
      {
        name: 'echo-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );

    this.setupHandlers();
  }

  setupHandlers() {
    // Echo tool - returns whatever arguments it receives
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'echo',
            description: 'Echo back the provided arguments',
            inputSchema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'Message to echo back',
                },
                data: {
                  type: 'object',
                  description: 'Data to echo back',
                },
              },
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'echo') {
        return {
          content: [
            {
              type: 'text',
              text: `Echo: ${JSON.stringify(args, null, 2)}`,
            },
          ],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    });

    // Echo resource - returns a simple resource
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'echo://test',
            name: 'Echo Test Resource',
            description: 'A test resource for echoing',
            mimeType: 'text/plain',
          },
        ],
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'echo://test') {
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: 'This is an echo test resource',
            },
          ],
        };
      }

      throw new Error(`Resource not found: ${uri}`);
    });

    // Custom echo method for testing arbitrary requests
    // Note: Custom methods require proper schema definition
    // For now, commenting out until we can create proper schemas

    // Ping handler
    this.server.setRequestHandler(PingRequestSchema, async () => {
      return {};
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

// Parse simple arguments (--key=value)
args.forEach((arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    config[key] = value || true;
  }
});

const server = new EchoServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Echo server shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Echo server terminated');
  process.exit(0);
});

// Disable console logging to avoid interfering with JSON-RPC
if (!config.debug) {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
}

server.run().catch((error) => {
  console.error('Echo server error:', error);
  process.exit(1);
});
