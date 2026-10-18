// Demonstration backend only: readiness covers exactly source.txt, not a native index.
import { createHash } from 'node:crypto';
import { access, appendFile, mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [mode, checkout, label = 'demo'] = process.argv.slice(2);
const file = (name) => path.join(checkout, name);
async function exists(name) {
  try {
    await access(file(name));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function digest() {
  return createHash('sha256')
    .update(await readFile(file('source.txt')))
    .digest('hex');
}
async function probe() {
  if (await exists('unknown.marker')) return 99;
  if (await exists('writer.lock')) return 12;
  const current = await digest();
  if (!(await exists('prepared.marker'))) return 10;
  return (await readFile(file('prepared.marker'), 'utf8')) === current ? 0 : 11;
}

if (mode === 'probe') {
  process.exitCode = await probe();
} else if (mode === 'initialize' || mode === 'sync') {
  // All writers in this toy backend honor this lock; this says nothing about native backends.
  await mkdir(file('writer.lock'));
  try {
    await appendFile(file('preparations.log'), `${mode}\n`);
    await writeFile(file('input.txt'), label);
    await writeFile(file('preparation-started.marker'), 'running');
    const deadline = Date.now() + 20000;
    while (!(await exists('preparation-release.marker'))) {
      if (Date.now() >= deadline) throw new Error('Fixture release deadline exceeded');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await writeFile(file('prepared.pending'), await digest());
    await rename(file('prepared.pending'), file('prepared.marker'));
  } finally {
    await rmdir(file('writer.lock'));
  }
} else if (mode === 'serve') {
  const server = new Server({ name: 'recipe-fixture', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await exists('prepared.marker'))
      ? [{ name: 'source', inputSchema: { type: 'object', properties: {} } }]
      : [],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'source' || (await probe()) !== 0) throw new Error('Not prepared');
    await appendFile(file('operations.log'), 'source\n');
    return { content: [{ type: 'text', text: await readFile(file('source.txt'), 'utf8') }] };
  });
  await server.connect(new StdioServerTransport());
} else {
  throw new Error('Expected probe, initialize, sync, or serve');
}
