#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const marker = process.argv[2];
const server = new Server({ name: 'deadline-tool-server', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'wait',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, delayMs: { type: 'integer', minimum: 0 } },
        required: ['id', 'delayMs'],
      },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'wait') throw new Error('Unknown tool');
  const { id, delayMs } = request.params.arguments;
  appendFileSync(marker, `${id}:start\n`, { mode: 0o600 });
  await setTimeout(delayMs);
  appendFileSync(marker, `${id}:end\n`, { mode: 0o600 });
  const result = { id, completed: true };
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
});
server.setRequestHandler(PingRequestSchema, async () => ({}));
await server.connect(new StdioServerTransport());
