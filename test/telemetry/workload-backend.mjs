import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListRootsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'acceptance-backend', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } },
    { name: 'slow', description: 'Delayed echo', inputSchema: { type: 'object' } },
    { name: 'reverse', description: 'Request owned client roots', inputSchema: { type: 'object' } },
    { name: 'error', description: 'Tool error', inputSchema: { type: 'object' } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'slow') {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { content: [{ type: 'text', text: 'slow-ok' }] };
  }
  if (request.params.name === 'reverse') {
    const result = await server.request(
      { method: 'roots/list', params: { _meta: request.params._meta } },
      ListRootsResultSchema,
    );
    return { content: [{ type: 'text', text: result.roots.length === 1 ? 'reverse-ok' : 'reverse-failed' }] };
  }
  if (request.params.name === 'error')
    return { isError: true, content: [{ type: 'text', text: 'expected Tool error' }] };
  if (request.params.name === 'echo')
    return { content: [{ type: 'text', text: request.params.arguments?.message ?? '' }] };
  throw new Error('Unknown fixture tool');
});
await server.connect(new StdioServerTransport());
