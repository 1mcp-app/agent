#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

class CapabilityServer {
  constructor() {
    this.server = new Server(
      {
        name: 'capability-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {
            subscribe: true,
            listChanged: true,
          },
          prompts: {},
          logging: {},
        },
      },
    );

    this.resources = new Map();
    this.subscribers = new Set();
    this.setupHandlers();
    this.setupDynamicResources();
  }

  setupHandlers() {
    // Tools
    this.server.setRequestHandler({ method: 'tools/list' }, async () => {
      return {
        tools: [
          {
            name: 'create_resource',
            description: 'Create a new dynamic resource',
            inputSchema: {
              type: 'object',
              properties: {
                uri: { type: 'string' },
                name: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['uri', 'name', 'content'],
            },
          },
          {
            name: 'delete_resource',
            description: 'Delete a dynamic resource',
            inputSchema: {
              type: 'object',
              properties: {
                uri: { type: 'string' },
              },
              required: ['uri'],
            },
          },
          {
            name: 'capability_info',
            description: 'Get server capability information',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    this.server.setRequestHandler({ method: 'tools/call' }, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'create_resource': {
          const resource = {
            uri: args.uri,
            name: args.name,
            description: `Dynamic resource: ${args.name}`,
            mimeType: 'text/plain',
            content: args.content,
          };
          this.resources.set(args.uri, resource);
          this.notifyResourcesChanged();

          return {
            content: [
              {
                type: 'text',
                text: `Created resource: ${args.uri}`,
              },
            ],
          };
        }

        case 'delete_resource': {
          if (this.resources.has(args.uri)) {
            this.resources.delete(args.uri);
            this.notifyResourcesChanged();
            return {
              content: [
                {
                  type: 'text',
                  text: `Deleted resource: ${args.uri}`,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `Resource not found: ${args.uri}`,
                },
              ],
            };
          }
        }

        case 'capability_info': {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    tools: this.server.getCapabilities().tools,
                    resources: this.server.getCapabilities().resources,
                    prompts: this.server.getCapabilities().prompts,
                    logging: this.server.getCapabilities().logging,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // Resources
    this.server.setRequestHandler({ method: 'resources/list' }, async () => {
      const staticResources = [
        {
          uri: 'capability://static/info',
          name: 'Server Information',
          description: 'Static information about this server',
          mimeType: 'application/json',
        },
        {
          uri: 'capability://static/capabilities',
          name: 'Server Capabilities',
          description: 'Detailed capability information',
          mimeType: 'application/json',
        },
      ];

      const dynamicResources = Array.from(this.resources.values()).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }));

      return {
        resources: [...staticResources, ...dynamicResources],
      };
    });

    this.server.setRequestHandler({ method: 'resources/read' }, async (request) => {
      const { uri } = request.params;

      if (uri === 'capability://static/info') {
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  name: 'capability-server',
                  version: '1.0.0',
                  description: 'Test server with full MCP capabilities',
                  dynamicResources: this.resources.size,
                  subscribers: this.subscribers.size,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (uri === 'capability://static/capabilities') {
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(this.server.getCapabilities(), null, 2),
            },
          ],
        };
      }

      // Check dynamic resources
      if (this.resources.has(uri)) {
        const resource = this.resources.get(uri);
        return {
          contents: [
            {
              uri,
              mimeType: resource.mimeType,
              text: resource.content,
            },
          ],
        };
      }

      throw new Error(`Resource not found: ${uri}`);
    });

    // Resource subscriptions
    this.server.setRequestHandler({ method: 'resources/subscribe' }, async (request) => {
      const { uri } = request.params;
      this.subscribers.add(uri);
      return {};
    });

    this.server.setRequestHandler({ method: 'resources/unsubscribe' }, async (request) => {
      const { uri } = request.params;
      this.subscribers.delete(uri);
      return {};
    });

    // Prompts
    this.server.setRequestHandler({ method: 'prompts/list' }, async () => {
      return {
        prompts: [
          {
            name: 'capability_test',
            description: 'Test prompt for capability demonstration',
            arguments: [
              {
                name: 'topic',
                description: 'Topic to generate prompt about',
                required: true,
              },
            ],
          },
        ],
      };
    });

    this.server.setRequestHandler({ method: 'prompts/get' }, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'capability_test') {
        const topic = args?.topic || 'general';
        return {
          description: `Capability test prompt for topic: ${topic}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Generate a comprehensive test about ${topic} capabilities.`,
              },
            },
          ],
        };
      }

      throw new Error(`Unknown prompt: ${name}`);
    });

    // Logging
    this.server.setRequestHandler({ method: 'logging/setLevel' }, async (request) => {
      const { level } = request.params;
      console.error(`Log level set to: ${level}`);
      return {};
    });

    // Ping
    this.server.setRequestHandler({ method: 'ping' }, async () => {
      return {
        status: 'pong',
        capabilities: Object.keys(this.server.getCapabilities()),
        resources: this.resources.size,
      };
    });
  }

  setupDynamicResources() {
    // Create some initial dynamic resources
    this.resources.set('capability://dynamic/example1', {
      uri: 'capability://dynamic/example1',
      name: 'Example Dynamic Resource 1',
      description: 'First example of dynamic resource',
      mimeType: 'text/plain',
      content: 'This is a dynamic resource that was created at server startup.',
    });

    this.resources.set('capability://dynamic/example2', {
      uri: 'capability://dynamic/example2',
      name: 'Example Dynamic Resource 2',
      description: 'Second example of dynamic resource',
      mimeType: 'application/json',
      content: JSON.stringify({ dynamic: true, created: new Date().toISOString() }),
    });
  }

  notifyResourcesChanged() {
    // In a real implementation, this would send notifications to subscribers
    // For testing, we'll just log it
    console.error(`Resources changed notification sent to ${this.subscribers.size} subscribers`);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Handle CLI arguments
const args = process.argv.slice(2);
const config = {};

args.forEach((arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    config[key] = value || true;
  }
});

const server = new CapabilityServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Capability server shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Capability server terminated');
  process.exit(0);
});

// Disable console logging to avoid interfering with JSON-RPC
if (!config.debug) {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
}

server.run().catch((error) => {
  console.error('Capability server error:', error);
  process.exit(1);
});
