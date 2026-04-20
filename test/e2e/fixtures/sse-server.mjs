import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';

const app = express();
app.use(express.json());

const transports = {};

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/message', res);
  const server = new Server(
    { name: 'sse-test', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'hello', description: 'Hello tool', inputSchema: { type: 'object', properties: {} } }],
  }));
  transports[transport.sessionId] = transport;
  await server.connect(transport);
});

app.post('/message', async (req, res) => {
  const { searchParams } = new URL(req.url, 'http://localhost');
  const sessionId = searchParams.get('sessionId');
  await transports[sessionId]?.handlePostMessage(req, res);
});

app.listen(9090, () => console.error('SSE server on :9090'));
