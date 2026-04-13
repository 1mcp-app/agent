#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';

class InspectTemplateServer {
  constructor() {
    this.server = new Server(
      {
        name: 'inspect-template-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
        instructions: '# Serena Instructions\nUse Serena for semantic code navigation and editing.',
      },
    );

    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'find_symbol',
          description: 'Find code symbols by name path pattern.',
          inputSchema: {
            type: 'object',
            properties: {
              name_path_pattern: {
                type: 'string',
                description: 'The symbol pattern to search for.',
              },
              relative_path: {
                type: 'string',
                description: 'Optional file or directory restriction.',
              },
            },
            required: ['name_path_pattern'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name !== 'find_symbol') {
        throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ matched: args?.name_path_pattern ?? null }),
          },
        ],
      };
    });

    this.server.setRequestHandler(PingRequestSchema, async () => ({}));
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new InspectTemplateServer();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

server.run().catch((error) => {
  console.error('Inspect template server error:', error);
  process.exit(1);
});
