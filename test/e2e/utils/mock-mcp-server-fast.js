#!/usr/bin/env node

/**
 * Ultra-fast Minimal MCP Server for Testing
 *
 * This is an optimized version that uses direct buffer-based I/O
 * instead of readline interface for faster startup and response times.
 */

const serverName = process.argv[2] || 'test-server';

// Pre-build response objects to avoid repeated JSON serialization
const initializeResponse = JSON.stringify({
  jsonrpc: '2.0',
  result: {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: serverName, version: '1.0.0' },
  },
});

const toolsListResponse = JSON.stringify({
  jsonrpc: '2.0',
  result: {
    tools: [
      {
        name: 'test_tool',
        description: `A test tool from ${serverName}`,
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'A test message' },
          },
        },
      },
      {
        name: `${serverName}_tool`,
        description: `A tool for ${serverName}`,
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'A test message' },
          },
        },
      },
    ],
  },
});

const resourcesListResponse = JSON.stringify({
  jsonrpc: '2.0',
  result: {
    resources: [
      {
        uri: `test://${serverName}/resource1`,
        name: `${serverName}_1mcp_test_resource`,
        description: `A test resource from ${serverName}`,
        mimeType: 'text/plain',
      },
    ],
  },
});

const promptsListResponse = JSON.stringify({
  jsonrpc: '2.0',
  result: {
    prompts: [
      {
        name: `${serverName}_1mcp_test_prompt`,
        description: `A test prompt from ${serverName}`,
        arguments: [
          {
            name: 'message',
            description: 'A test message',
            required: false,
          },
        ],
      },
    ],
  },
});

// Signal ready immediately
process.stderr.write(`${serverName} ready\n`);

// Buffer for incoming data
let buffer = Buffer.alloc(0);

// Process each line in buffer
function processBuffer() {
  while (true) {
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex === -1) break;

    // Extract line
    const lineBytes = buffer.subarray(0, newlineIndex);
    buffer = buffer.subarray(newlineIndex + 1);

    if (lineBytes.length === 0) continue;

    try {
      const request = JSON.parse(lineBytes.toString('utf8'));

      // Build response based on method
      let responseStr;
      let id = request.id;

      if (request.method === 'initialize') {
        responseStr = initializeResponse.slice(0, -1) + `,"id":${id}}`;
      } else if (request.method === 'tools/list') {
        responseStr = toolsListResponse.slice(0, -1) + `,"id":${id}}`;
      } else if (request.method === 'resources/list') {
        responseStr = resourcesListResponse.slice(0, -1) + `,"id":${id}}`;
      } else if (request.method === 'prompts/list') {
        responseStr = promptsListResponse.slice(0, -1) + `,"id":${id}}`;
      } else if (request.method === 'tools/call') {
        responseStr = JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Called ${request.params.name} on ${serverName}`,
              },
            ],
          },
        });
      } else if (request.method === 'ping') {
        responseStr = JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {},
        });
      } else {
        // Unknown method
        responseStr = JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        });
      }

      process.stdout.write(responseStr + '\n');
    } catch {
      // Parse error - send error response
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }) + '\n',
      );
    }
  }
}

// Handle incoming data
process.stdin.on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  processBuffer();
});

// Keep process alive
process.on('SIGINT', () => {
  process.exit(0);
});
