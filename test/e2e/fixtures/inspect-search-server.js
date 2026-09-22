#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'inspect-search-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
const tools = [
  { name: 'alpha', description: 'Original description' },
  { name: 'hidden', description: 'Needle disabled tool' },
  { name: 'alpha.late', description: 'Needle on the second upstream page' },
  { name: 'beta', description: 'Other description' },
  { name: 'no_description' },
].map((tool) => ({
  ...tool,
  inputSchema: {
    type: 'object',
    properties: { required: { type: 'string' }, optional: { type: 'boolean' } },
    required: ['required'],
  },
}));
server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
  if (params?.cursor === undefined) return { tools: tools.slice(0, 2), nextCursor: 'second' };
  if (params.cursor === 'second') return { tools: tools.slice(2) };
  throw new Error('Invalid fixture cursor');
});
server.setRequestHandler(PingRequestSchema, async () => ({}));
await server.connect(new StdioServerTransport());
