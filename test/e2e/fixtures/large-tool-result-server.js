import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'large-tool-result', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_file',
      inputSchema: {
        type: 'object',
        properties: { bytes: { type: 'integer', minimum: 0, maximum: 5_000_000 } },
        required: ['bytes'],
      },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
  content: [
    {
      type: 'resource',
      resource: {
        uri: 'file:///synthetic.bin',
        mimeType: 'application/octet-stream',
        blob: Buffer.alloc(params.arguments.bytes, 7).toString('base64'),
      },
    },
  ],
}));
await server.connect(new StdioServerTransport());
