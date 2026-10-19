import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListRootsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { privacyCorpus } from './privacy-corpus.mjs';

const server = new Server({ name: 'acceptance-backend', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...Array.from({ length: Number(process.env.ACCEPTANCE_CAPACITY_TOOLS ?? 0) }, (_, i) => ({
      name: `private_tool_${i}`,
      inputSchema: { type: 'object' },
    })),
    { name: 'diagnostics', inputSchema: { type: 'object' } },
    { name: 'rpc-failure', inputSchema: { type: 'object' } },
    { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } },
    { name: 'slow', description: 'Delayed echo', inputSchema: { type: 'object' } },
    { name: 'reverse', description: 'Request owned client roots', inputSchema: { type: 'object' } },
    { name: 'error', description: 'Tool error', inputSchema: { type: 'object' } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name.startsWith('private_tool_')) return { content: [{ type: 'text', text: 'capacity-ok' }] };
  if (request.params.name === 'diagnostics') {
    process.stderr.write(JSON.stringify(privacyCorpus) + '\n');
    return { content: [{ type: 'text', text: JSON.stringify(privacyCorpus) }] };
  }
  if (request.params.name === 'rpc-failure') {
    const failure = new Error(privacyCorpus.error);
    failure.stack = privacyCorpus.stack;
    throw failure;
  }
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
