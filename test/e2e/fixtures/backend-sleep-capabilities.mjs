import { appendFileSync } from 'node:fs';

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
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const [eventsPath, name, daemonUrl] = process.argv.slice(2);
const uri = `sleep://${name}/value`;
let subscribed = false;
const record = (event) => appendFileSync(eventsPath, `${JSON.stringify({ pid: process.pid, ...event })}\n`);
record({ event: 'start' });
const server = new Server(
  { name, version: '1' },
  { capabilities: { tools: {}, resources: { subscribe: true }, prompts: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ['daemon', 'notify'].map((name) => ({ name, inputSchema: { type: 'object', properties: {} } })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  record({ event: 'dispatch', message: 'tools/call' });
  if (params.name === 'notify') {
    if (subscribed) await server.sendResourceUpdated({ uri });
    return { content: [{ type: 'text', text: 'notified' }] };
  }
  const response = await fetch(daemonUrl);
  if (!response.ok) throw new Error('Independent daemon unavailable');
  return { content: [{ type: 'text', text: await response.text() }] };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri, name }] }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
server.setRequestHandler(ReadResourceRequestSchema, async () => {
  record({ event: 'dispatch', message: 'resources/read' });
  return { contents: [{ uri, text: `${name} from ${process.pid}` }] };
});
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [{ name: 'greeting', description: name }],
}));
server.setRequestHandler(GetPromptRequestSchema, async () => {
  record({ event: 'dispatch', message: 'prompts/get' });
  return { messages: [{ role: 'user', content: { type: 'text', text: `${name} from ${process.pid}` } }] };
});
server.setRequestHandler(SubscribeRequestSchema, async () => {
  record({ event: 'dispatch', message: 'resources/subscribe' });
  subscribed = true;
  return {};
});
server.setRequestHandler(UnsubscribeRequestSchema, async () => {
  record({ event: 'dispatch', message: 'resources/unsubscribe' });
  subscribed = false;
  return {};
});
await server.connect(new StdioServerTransport());
record({ event: 'ready' });
