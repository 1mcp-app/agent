import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { appendFileSync } from 'node:fs';

import { z } from 'zod';

const eventsPath = process.argv[2];
const record = (event) => appendFileSync(eventsPath, `${JSON.stringify({ pid: process.pid, ...event })}\n`);
record({ event: 'start' });
serveStdio(
  () => {
    const server = new McpServer(
      { name: 'modern-sleep-fixture', version: '1' },
      { supportedProtocolVersions: ['2026-07-28'] },
    );
    server.registerTool('record', { inputSchema: { message: z.string() } }, async ({ message }) => {
      record({ event: 'dispatch', message });
      return { content: [{ type: 'text', text: `${message} from ${process.pid}` }] };
    });
    return server;
  },
  { legacy: 'reject' },
);
