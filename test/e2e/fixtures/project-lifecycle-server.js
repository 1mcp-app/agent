import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const checkout = process.argv[2];
await appendFile(path.join(checkout, 'backend-pids.log'), `${process.pid}\n`);
const server = new Server({ name: 'lifecycle-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'source', inputSchema: { type: 'object', properties: {} } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: await readFile(path.join(checkout, 'source.txt'), 'utf8') }],
}));
await server.connect(new StdioServerTransport());
