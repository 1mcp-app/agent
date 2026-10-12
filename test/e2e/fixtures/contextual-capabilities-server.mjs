import { randomUUID } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const [project, clientName, clientVersion, clientTitle] = process.argv.slice(2);
const label = project === 'static' ? 'static' : 'contextual';
const instance = randomUUID();
let calls = 0;
const facts = () => ({ project, clientName, clientVersion, clientTitle, instance, calls });
const server = new Server(
  { name: 'contextual-capabilities-fixture', version: '1' },
  { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: `${label} fixture instructions` },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'probe', description: 'Report this instance', inputSchema: { type: 'object' } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  calls += 1;
  return { content: [{ type: 'text', text: JSON.stringify({ ...facts(), meta: request.params._meta ?? {} }) }] };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ name: `${label}-facts`, uri: 'fixture:///facts' }],
}));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [{ name: `${label}-dynamic-facts`, uriTemplate: 'fixture:///facts/{name}' }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
  contents: [{ uri: request.params.uri, text: JSON.stringify(facts()) }],
}));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'facts' }] }));
server.setRequestHandler(GetPromptRequestSchema, async () => ({
  messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(facts()) } }],
}));
await server.connect(new StdioServerTransport());
