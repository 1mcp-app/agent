import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [eventsPath, wakeGatePath] = process.argv.slice(2);
const replacement = existsSync(eventsPath);
const record = (event) => appendFileSync(eventsPath, `${JSON.stringify({ pid: process.pid, ...event })}\n`);
record({ event: 'start' });

// Hold only replacement initialization so callers can deterministically join one wake.
if (replacement) {
  const deadline = Date.now() + 20_000;
  while (!existsSync(wakeGatePath)) {
    if (Date.now() >= deadline) throw new Error('Replacement initialization gate was not released');
    await delay(20);
  }
}

const server = new Server({ name: 'backend-sleep-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ['record', 'forbidden'].map((name) => ({
    name,
    description: `Record a ${name} invocation`,
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  record({ event: 'dispatch', tool: params.name, message: params.arguments?.message });
  return { content: [{ type: 'text', text: String(params.arguments?.message) }] };
});
await server.connect(new StdioServerTransport());
record({ event: 'ready' });
