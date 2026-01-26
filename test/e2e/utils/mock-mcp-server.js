#!/usr/bin/env node

/**
 * Minimal MCP Server for Testing
 *
 * This script acts as a mock MCP server that responds to initialize and listTools requests.
 * It's designed to be used in E2E tests where a real MCP server is needed.
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

// Server configuration
const serverName = process.argv[2] || 'test-server';
const serverTools = [
  {
    name: 'test_tool',
    description: `A test tool from ${serverName}`,
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'A test message',
        },
      },
    },
  },
];

// Send ready notification immediately
console.error(`${serverName} ready`);

// Handle incoming requests
rl.on('line', (line) => {
  try {
    const request = JSON.parse(line);

    // Handle initialize
    if (request.method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: serverName,
            version: '1.0.0',
          },
        },
      };
      console.log(JSON.stringify(response));
      return;
    }

    // Handle tools/list
    if (request.method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: serverTools,
        },
      };
      console.log(JSON.stringify(response));
      return;
    }

    // Handle tools/call
    if (request.method === 'tools/call') {
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Called ${request.params.name} on ${serverName} with args: ${JSON.stringify(request.params.arguments)}`,
            },
          ],
        },
      };
      console.log(JSON.stringify(response));
      return;
    }

    // Unknown method
    const errorResponse = {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32601,
        message: `Method not found: ${request.method}`,
      },
    };
    console.log(JSON.stringify(errorResponse));
  } catch (error) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${error.message}`,
      },
    };
    console.log(JSON.stringify(errorResponse));
  }
});

// Keep process alive
process.on('SIGINT', () => {
  process.exit(0);
});
