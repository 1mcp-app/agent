import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const revision = process.argv[2];
const server = new Server(
  { name: 'disabled-static-fixture', version: '1' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);
const identity = () => ({ pid: process.pid, revision });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'identity', inputSchema: { type: 'object' } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: JSON.stringify(identity()) }],
}));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ uri: 'fixture:///identity', name: 'identity' }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async () => ({
  contents: [{ uri: 'fixture:///identity', text: JSON.stringify(identity()) }],
}));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'identity' }] }));
server.setRequestHandler(GetPromptRequestSchema, async () => ({
  messages: [{ role: 'user', content: { type: 'text', text: revision } }],
}));
await server.connect(new StdioServerTransport());
