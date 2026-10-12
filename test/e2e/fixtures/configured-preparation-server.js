import { access, appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [mode, checkout] = process.argv.slice(2);
const marker = path.join(checkout, 'prepared.marker');
async function ready() {
  try {
    await access(marker);
    return true;
  } catch {
    return false;
  }
}
if (mode === 'probe') {
  process.exitCode = (await ready()) ? 0 : 10;
} else if (mode === 'initialize') {
  await appendFile(path.join(checkout, 'preparations.log'), 'initialize\n');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await writeFile(marker, 'ready');
} else if (mode === 'serve') {
  const server = new Server({ name: 'configured-fixture', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await ready()) ? [{ name: 'source', inputSchema: { type: 'object', properties: {} } }] : [],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'source' || !(await ready())) throw new Error('Not prepared');
    await appendFile(path.join(checkout, 'operations.log'), 'source\n');
    return { content: [{ type: 'text', text: await readFile(path.join(checkout, 'source.txt'), 'utf8') }] };
  });
  await server.connect(new StdioServerTransport());
} else {
  throw new Error('Unknown fixture mode');
}
