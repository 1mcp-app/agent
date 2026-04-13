#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';

class RunToolServer {
  constructor() {
    this.server = new Server(
      {
        name: 'run-tool-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'echo_args',
          description: 'Echo message payloads for testing.',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Message to echo back.',
              },
              count: {
                type: 'number',
                description: 'Optional number attached to the response.',
              },
              mode: {
                type: 'string',
                description: 'How to format the echo result.',
                enum: ['plain', 'json'],
                default: 'plain',
              },
              payload: {
                type: 'object',
                description: 'Optional metadata attached to the message.',
              },
            },
            required: ['message'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              echoed: { type: 'string' },
              count: { type: 'number' },
            },
          },
          examples: [{ message: 'hello' }, { message: 'hello', count: 2, mode: 'json' }],
        },
        {
          name: 'emit_text',
          description: 'Emit the provided text exactly',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
        {
          name: 'summarize',
          description: 'Summarize text input',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
        {
          name: 'fail_tool',
          description: 'Return an MCP tool error result',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'echo_args':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(args ?? {}, null, 2),
              },
            ],
          };
        case 'emit_text':
          return {
            content: [
              {
                type: 'text',
                text: String(args?.text ?? ''),
              },
            ],
          };
        case 'summarize': {
          const text = String(args?.text ?? '');
          const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
          return {
            content: [
              {
                type: 'text',
                text: `summary(${words}w): ${text}`,
              },
            ],
          };
        }
        case 'fail_tool':
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `tool failed: ${String(args?.message ?? 'unknown error')}`,
              },
            ],
          };
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    this.server.setRequestHandler(PingRequestSchema, async () => ({}));
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new RunToolServer();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

server.run().catch((error) => {
  console.error('Run tool server error:', error);
  process.exit(1);
});
