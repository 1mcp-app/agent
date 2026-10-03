import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'tracing-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'trace', inputSchema: { type: 'object' } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: JSON.stringify(request.params._meta ?? {}) }],
  _meta: { baggage: 'secret-response-carrier', other: 'preserved' },
  structuredContent: { baggage: 'legit' },
}));
await server.connect(new StdioServerTransport());
