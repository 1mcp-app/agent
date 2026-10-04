import { appendFileSync } from 'node:fs';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Synthetic workload: 13 processes * 12 distinct schemas exceeds 128 total schemas.
// This does not assert that all admissions are queued simultaneously.
// It does not contain the reporter's unavailable failing schema.
const [id, journal] = process.argv.slice(2);
const server = new Server({ name: `acceptance-${id}`, version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Array.from({ length: 12 }, (_, index) => ({
    name: `echo_${index}`,
    description: `Synthetic tool ${id}/${index}`,
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: `Distinct schema ${id}/${index}` } },
      required: ['message'],
      additionalProperties: false,
    },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  appendFileSync(journal, JSON.stringify({ server: id, tool: request.params.name }) + '\n');
  return { content: [{ type: 'text', text: `${id}:${request.params.arguments.message}` }] };
});
await server.connect(new StdioServerTransport());
