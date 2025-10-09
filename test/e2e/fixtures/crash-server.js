#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

class CrashServer {
  constructor(config = {}) {
    this.config = {
      crashAfter: 0, // 0 = don't crash automatically
      memoryLeak: false,
      ...config,
    };

    this.server = new Server(
      {
        name: 'crash-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    );

    this.requestCount = 0;
    this.memoryArray = [];
    this.setupHandlers();
    this.setupCrashTimer();
  }

  setupHandlers() {
    // Tools that can cause crashes
    this.server.setRequestHandler({ method: 'tools/list' }, async () => {
      this.incrementRequestCount();

      return {
        tools: [
          {
            name: 'crash_immediately',
            description: 'Crashes the server immediately',
            inputSchema: {
              type: 'object',
              properties: {
                exitCode: {
                  type: 'number',
                  description: 'Exit code to use',
                  default: 1,
                },
              },
            },
          },
          {
            name: 'crash_after_delay',
            description: 'Crashes after a specified delay',
            inputSchema: {
              type: 'object',
              properties: {
                delay: {
                  type: 'number',
                  description: 'Delay in milliseconds before crash',
                  default: 1000,
                },
                exitCode: {
                  type: 'number',
                  description: 'Exit code to use',
                  default: 1,
                },
              },
            },
          },
          {
            name: 'throw_exception',
            description: 'Throws an unhandled exception',
            inputSchema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'Exception message',
                  default: 'Intentional test exception',
                },
              },
            },
          },
          {
            name: 'memory_bomb',
            description: 'Consumes excessive memory',
            inputSchema: {
              type: 'object',
              properties: {
                sizeMB: {
                  type: 'number',
                  description: 'Memory to consume in MB',
                  default: 100,
                },
              },
            },
          },
          {
            name: 'infinite_loop',
            description: 'Enters an infinite loop',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description: 'Type of infinite loop',
                  enum: ['cpu', 'memory', 'io'],
                  default: 'cpu',
                },
              },
            },
          },
          {
            name: 'status_check',
            description: 'Returns server status and crash configuration',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    this.server.setRequestHandler({ method: 'tools/call' }, async (request) => {
      this.incrementRequestCount();
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'crash_immediately': {
          const exitCode = args?.exitCode || 1;
          console.error(`Crashing immediately with exit code ${exitCode}`);
          process.exit(exitCode);
          break;
        }

        case 'crash_after_delay': {
          const delay = args?.delay || 1000;
          const delayExitCode = args?.exitCode || 1;

          setTimeout(() => {
            console.error(`Crashing after ${delay}ms delay with exit code ${delayExitCode}`);
            process.exit(delayExitCode);
          }, delay);

          return {
            content: [
              {
                type: 'text',
                text: `Crash scheduled in ${delay}ms with exit code ${delayExitCode}`,
              },
            ],
          };
        }

        case 'throw_exception': {
          const message = args?.message || 'Intentional test exception';
          throw new Error(message);
        }

        case 'memory_bomb': {
          const sizeMB = args?.sizeMB || 100;
          const arraySize = (sizeMB * 1024 * 1024) / 8; // 8 bytes per number

          try {
            const memoryArray = new Array(arraySize).fill(Math.random());
            // Keep reference to prevent GC
            this.memoryArray.push(memoryArray);

            return {
              content: [
                {
                  type: 'text',
                  text: `Allocated ${sizeMB}MB of memory. Total arrays: ${this.memoryArray.length}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to allocate ${sizeMB}MB: ${error.message}`,
                },
              ],
            };
          }
        }

        case 'infinite_loop': {
          const loopType = args?.type || 'cpu';

          if (loopType === 'cpu') {
            // CPU-intensive infinite loop
            setImmediate(() => {
              while (true) {
                Math.random() * Math.random();
              }
            });
          } else if (loopType === 'memory') {
            // Memory-leaking infinite loop
            setImmediate(() => {
              while (true) {
                this.memoryArray.push(new Array(1000).fill(Math.random()));
              }
            });
          } else if (loopType === 'io') {
            // I/O infinite loop
            setImmediate(() => {
              const recursiveIO = () => {
                setImmediate(recursiveIO);
              };
              recursiveIO();
            });
          }

          return {
            content: [
              {
                type: 'text',
                text: `Started infinite ${loopType} loop`,
              },
            ],
          };
        }

        case 'status_check': {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    requestCount: this.requestCount,
                    uptime: process.uptime(),
                    memoryUsage: process.memoryUsage(),
                    pid: process.pid,
                    config: this.config,
                    memoryArrays: this.memoryArray.length,
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

    // Resources that can cause crashes
    this.server.setRequestHandler({ method: 'resources/list' }, async () => {
      this.incrementRequestCount();

      return {
        resources: [
          {
            uri: 'crash://test/exception',
            name: 'Exception Resource',
            description: 'Reading this resource throws an exception',
            mimeType: 'text/plain',
          },
          {
            uri: 'crash://test/hang',
            name: 'Hanging Resource',
            description: 'Reading this resource hangs the process',
            mimeType: 'text/plain',
          },
          {
            uri: 'crash://test/corrupt',
            name: 'Corrupt Resource',
            description: 'Returns corrupted data',
            mimeType: 'application/json',
          },
        ],
      };
    });

    this.server.setRequestHandler({ method: 'resources/read' }, async (request) => {
      this.incrementRequestCount();
      const { uri } = request.params;

      if (uri === 'crash://test/exception') {
        throw new Error('Resource read exception as intended');
      }

      if (uri === 'crash://test/hang') {
        // Infinite hang
        await new Promise(() => {});
      }

      if (uri === 'crash://test/corrupt') {
        // Return malformed JSON
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: '{ "malformed": json, missing quotes and commas }',
            },
          ],
        };
      }

      throw new Error(`Resource not found: ${uri}`);
    });

    // Ping handler that might crash randomly
    this.server.setRequestHandler({ method: 'ping' }, async () => {
      this.incrementRequestCount();

      // 5% chance of random crash on ping
      if (Math.random() < 0.05) {
        console.error('Random crash on ping');
        process.exit(42);
      }

      return {
        status: 'pong',
        requestCount: this.requestCount,
        uptime: process.uptime(),
      };
    });

    // Custom crash methods
    this.server.setRequestHandler({ method: 'crash/signal' }, async (request) => {
      const { signal = 'SIGTERM' } = request.params || {};

      setTimeout(() => {
        console.error(`Sending signal ${signal} to self`);
        process.kill(process.pid, signal);
      }, 100);

      return { message: `Signal ${signal} sent` };
    });

    this.server.setRequestHandler({ method: 'crash/segfault' }, async () => {
      // Simulate segmentation fault
      setTimeout(() => {
        console.error('Simulating segmentation fault');
        process.abort();
      }, 100);

      return { message: 'Segmentation fault scheduled' };
    });
  }

  incrementRequestCount() {
    this.requestCount++;

    // Check if we should crash based on request count
    if (this.config.crashAfter > 0 && this.requestCount >= this.config.crashAfter) {
      console.error(`Crashing after ${this.requestCount} requests as configured`);
      process.exit(1);
    }
  }

  setupCrashTimer() {
    // Set up memory leak if configured
    if (this.config.memoryLeak) {
      setInterval(() => {
        this.memoryArray.push(new Array(10000).fill(Math.random()));
      }, 100);
    }
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
    if (value && !isNaN(Number(value))) {
      config[key] = Number(value);
    } else if (value === 'true' || value === 'false') {
      config[key] = value === 'true';
    } else {
      config[key] = value || true;
    }
  }
});

const server = new CrashServer(config);

// Handle signals (but allow some to cause crashes for testing)
process.on('SIGINT', () => {
  console.error('Crash server received SIGINT, shutting down...');
  process.exit(0);
});

// Don't handle SIGTERM - let it crash for testing
// process.on('SIGTERM', () => { ... });

// Handle uncaught exceptions and log them
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Disable console logging to avoid interfering with JSON-RPC
if (!config.debug) {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
}

server.run().catch((error) => {
  console.error('Crash server error:', error);
  process.exit(1);
});
