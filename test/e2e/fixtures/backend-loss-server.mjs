import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const name = process.argv[2];
const uri = `test://${name}/watch`;
const watches = new Set();
let changed = false;
const server = new Server(
  { name, version: '1' },
  {
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
    },
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ['pid', 'echo', 'change', 'update', ...(changed ? ['added'] : [])].map((tool) => ({
    name: tool,
    inputSchema: { type: 'object', properties: {} },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (params.name === 'change') {
    changed = true;
    await server.sendToolListChanged();
    await server.sendResourceListChanged();
    await server.sendPromptListChanged();
  }
  if (params.name === 'update' && watches.has(uri)) await server.sendResourceUpdated({ uri });
  return { content: [{ type: 'text', text: params.name === 'pid' ? String(process.pid) : name }] };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri, name }] }));
server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri, text: name }] }));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'greeting' }] }));
server.setRequestHandler(GetPromptRequestSchema, async () => ({
  messages: [{ role: 'user', content: { type: 'text', text: name } }],
}));
server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
  watches.add(params.uri);
  return {};
});
server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
  watches.delete(params.uri);
  return {};
});
process.on('SIGTERM', () => process.exit(0));
await server.connect(new StdioServerTransport());
