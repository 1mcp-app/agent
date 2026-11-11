import { randomUUID } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const handles = new Set();
const server = new Server({ name: 'stateful-legacy', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'remember', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'recall',
      inputSchema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const handle = params.name === 'remember' ? randomUUID() : params.arguments?.handle;
  if (params.name === 'remember') handles.add(handle);
  return {
    content: [{ type: 'text', text: JSON.stringify({ handle, pid: process.pid, retained: handles.has(handle) }) }],
  };
});
await server.connect(new StdioServerTransport());
