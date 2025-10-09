#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

class SlowServer {
  constructor(config = {}) {
    this.config = {
      defaultDelay: 1000,
      startupDelay: 0,
      ...config,
    };

    this.server = new Server(
      {
        name: 'slow-server',
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

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  setupHandlers() {
    // Tools with configurable delays
    this.server.setRequestHandler({ method: 'tools/list' }, async () => {
      await this.delay(this.config.defaultDelay);

      return {
        tools: [
          {
            name: 'slow_operation',
            description: 'Performs a slow operation with configurable delay',
            inputSchema: {
              type: 'object',
              properties: {
                delay: {
                  type: 'number',
                  description: 'Delay in milliseconds',
                  default: this.config.defaultDelay,
                },
                operation: {
                  type: 'string',
                  description: 'Type of operation to perform',
                  enum: ['compute', 'io', 'network'],
                },
              },
            },
          },
          {
            name: 'timeout_test',
            description: 'Test operation that can exceed timeout limits',
            inputSchema: {
              type: 'object',
              properties: {
                duration: {
                  type: 'number',
                  description: 'Duration in milliseconds',
                  default: 30000,
                },
              },
            },
          },
          {
            name: 'progressive_delay',
            description: 'Operation that gets progressively slower',
            inputSchema: {
              type: 'object',
              properties: {
                steps: {
                  type: 'number',
                  description: 'Number of steps',
                  default: 5,
                },
                stepDelay: {
                  type: 'number',
                  description: 'Base delay per step in ms',
                  default: 1000,
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
        case 'slow_operation': {
          const delay = args?.delay || this.config.defaultDelay;
          const operation = args?.operation || 'compute';

          await this.delay(delay);

          return {
            content: [
              {
                type: 'text',
                text: `Completed ${operation} operation after ${delay}ms delay`,
              },
            ],
          };
        }

        case 'timeout_test': {
          const duration = args?.duration || 30000;

          const start = Date.now();
          await this.delay(duration);
          const actual = Date.now() - start;

          return {
            content: [
              {
                type: 'text',
                text: `Timeout test completed. Requested: ${duration}ms, Actual: ${actual}ms`,
              },
            ],
          };
        }

        case 'progressive_delay': {
          const steps = args?.steps || 5;
          const stepDelay = args?.stepDelay || 1000;
          const results = [];

          for (let i = 1; i <= steps; i++) {
            const currentDelay = stepDelay * i;
            await this.delay(currentDelay);
            results.push(`Step ${i}: ${currentDelay}ms delay completed`);
          }

          return {
            content: [
              {
                type: 'text',
                text: results.join('\n'),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // Slow resources
    this.server.setRequestHandler({ method: 'resources/list' }, async () => {
      await this.delay(this.config.defaultDelay);

      return {
        resources: [
          {
            uri: 'slow://data/small',
            name: 'Small Slow Data',
            description: 'Small dataset with artificial delay',
            mimeType: 'application/json',
          },
          {
            uri: 'slow://data/large',
            name: 'Large Slow Data',
            description: 'Large dataset with extended delay',
            mimeType: 'application/json',
          },
          {
            uri: 'slow://data/infinite',
            name: 'Infinite Delay',
            description: 'Resource that never returns (for timeout testing)',
            mimeType: 'text/plain',
          },
        ],
      };
    });

    this.server.setRequestHandler({ method: 'resources/read' }, async (request) => {
      const { uri } = request.params;

      if (uri === 'slow://data/small') {
        await this.delay(2000); // 2 second delay
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                size: 'small',
                delay: 2000,
                data: Array.from({ length: 10 }, (_, i) => ({ id: i, value: `item-${i}` })),
              }),
            },
          ],
        };
      }

      if (uri === 'slow://data/large') {
        await this.delay(5000); // 5 second delay
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                size: 'large',
                delay: 5000,
                data: Array.from({ length: 1000 }, (_, i) => ({
                  id: i,
                  value: `large-item-${i}`,
                  timestamp: new Date().toISOString(),
                })),
              }),
            },
          ],
        };
      }

      if (uri === 'slow://data/infinite') {
        // This will hang indefinitely for timeout testing
        await new Promise(() => {}); // Never resolves
      }

      throw new Error(`Resource not found: ${uri}`);
    });

    // Slow ping with random delays
    this.server.setRequestHandler({ method: 'ping' }, async () => {
      const randomDelay = Math.floor(Math.random() * 2000) + 500; // 500-2500ms
      await this.delay(randomDelay);

      return {
        status: 'pong',
        delay: randomDelay,
        timestamp: new Date().toISOString(),
      };
    });

    // Custom slow methods
    this.server.setRequestHandler({ method: 'slow/batch' }, async (request) => {
      const { operations = [], batchDelay = 1000 } = request.params || {};

      const results = [];
      for (const [index, operation] of operations.entries()) {
        await this.delay(batchDelay);
        results.push({
          index,
          operation,
          completed: new Date().toISOString(),
        });
      }

      return { results };
    });

    this.server.setRequestHandler({ method: 'slow/stress' }, async (request) => {
      const { iterations = 10, delay = 100 } = request.params || {};

      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        await this.delay(delay);
      }
      const duration = Date.now() - start;

      return {
        iterations,
        requestedTotalDelay: iterations * delay,
        actualDuration: duration,
        efficiency: (iterations * delay) / duration,
      };
    });
  }

  async run() {
    // Apply startup delay if configured
    if (this.config.startupDelay > 0) {
      await this.delay(this.config.startupDelay);
    }

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
    if (value && !isNaN(Number(value))) {
      config[key] = Number(value);
    } else {
      config[key] = value || true;
    }
  }
});

const server = new SlowServer(config);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Slow server shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Slow server terminated');
  process.exit(0);
});

// Disable console logging to avoid interfering with JSON-RPC
if (!config.debug) {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
}

server.run().catch((error) => {
  console.error('Slow server error:', error);
  process.exit(1);
});
