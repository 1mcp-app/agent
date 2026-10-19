import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';

import { createServer } from 'node:http';

export async function createModernBackend({ toolCount = 0 } = {}) {
  if (!Number.isInteger(toolCount) || toolCount < 0 || toolCount > 10000) throw new Error('Invalid fixture tool count');
  const capacityTools = Array.from({ length: toolCount }, (_, i) => ({
    name: `private_tool_${i}`,
    inputSchema: { type: 'object' },
  }));
  const capacityNames = new Set(capacityTools.map((tool) => tool.name));
  const handler = createMcpHandler(
    () => {
      const server = new Server(
        { name: 'acceptance-modern-backend', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler('tools/list', async (request) => {
        const tools = [
          ...capacityTools,
          {
            name: 'echo',
            description: 'Echo',
            inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
          },
          { name: 'reverse', description: 'Request owned roots', inputSchema: { type: 'object' } },
          { name: 'error', description: 'Tool error', inputSchema: { type: 'object' } },
        ];
        const offset = request.params?.cursor === undefined ? 0 : Number(request.params.cursor);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset >= tools.length)
          throw new Error('Invalid fixture cursor');
        const end = Math.min(offset + 1000, tools.length);
        return { tools: tools.slice(offset, end), ...(end < tools.length ? { nextCursor: String(end) } : {}) };
      });
      server.setRequestHandler('tools/call', async (request, context) => {
        if (capacityNames.has(request.params.name)) return { content: [{ type: 'text', text: 'capacity-ok' }] };
        if (request.params.name === 'reverse') {
          if (context.mcpReq.requestState() === undefined)
            return {
              resultType: 'input_required',
              requestState: 'PRIVACY_SESSION_489',
              inputRequests: { roots: { method: 'roots/list', params: {} } },
            };
          if (context.mcpReq.requestState() !== 'PRIVACY_SESSION_489') throw new Error('Wrong continuation state');
          if (context.mcpReq.inputResponses?.roots?.roots?.length !== 1) throw new Error('Wrong reverse result');
          return { content: [{ type: 'text', text: 'reverse-ok' }] };
        }
        return request.params.name === 'error'
          ? { isError: true, content: [{ type: 'text', text: 'expected Tool error' }] }
          : { content: [{ type: 'text', text: request.params.arguments?.message ?? '' }] };
      });
      return server;
    },
    { legacy: 'reject' },
  );
  const http = createServer(toNodeHandler(handler));
  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${http.address().port}/mcp`,
    close: async () => {
      await handler.close();
      http.closeAllConnections();
      await new Promise((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
