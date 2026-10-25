import assert from 'node:assert/strict';
import { createServer } from 'node:http';

export async function startConformanceMock(protocolVersion, options = {}) {
  if (typeof options === 'string') options = { tools: [{ name: options, inputSchema: { type: 'object' } }] };
  const tools = options.tools ?? [
    {
      name: 'add_numbers',
      description: 'Add two numbers.',
      inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    },
  ];
  const resources = options.resources ?? [];
  const prompts = options.prompts ?? [];
  const capabilities = {
    tools: {},
    ...(resources.length > 0 ? { resources: {} } : {}),
    ...(prompts.length > 0 ? { prompts: {} } : {}),
  };
  const requests = [];
  let rejectedModernProbe = false;
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ headers: req.headers, message });
      res.setHeader('content-type', 'application/json');
      if (protocolVersion === '2026-07-28' && !rejectedModernProbe) {
        rejectedModernProbe = true;
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32022,
              message: 'Unsupported protocol version',
              data: { supported: ['2026-07-28'], requested: 'synthetic-unsupported' },
            },
          }),
        );
        return;
      }
      let result = {};
      if (message.method === 'initialize') {
        result = {
          protocolVersion,
          capabilities,
          serverInfo: { name: 'conformance-mock', version: '1.0.0' },
        };
      } else if (message.method === 'server/discover') {
        result = {
          resultType: 'complete',
          ttlMs: 0,
          cacheScope: 'private',
          supportedVersions: ['2026-07-28'],
          capabilities,
          serverInfo: { name: 'conformance-mock', version: '1.0.0' },
        };
      } else if (message.method === 'tools/list') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          tools,
        };
      } else if (message.method === 'tools/call') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete' } : {}),
          content: [{ type: 'text', text: 'synthetic-result' }],
        };
        if (
          options.requestState &&
          ['test_mrtr_echo_state', 'test_mrtr_no_state'].includes(message.params.name) &&
          !message.params.inputResponses
        ) {
          result = {
            resultType: 'input_required',
            inputRequests: {
              confirmation: {
                method: 'elicitation/create',
                params: {
                  message: 'Confirm',
                  requestedSchema: {
                    type: 'object',
                    properties: { confirmed: { type: 'boolean' } },
                    required: ['confirmed'],
                  },
                },
              },
            },
            ...(message.params.name === 'test_mrtr_echo_state' ? { requestState: 'opaque-state' } : {}),
          };
        }
        if (options.continuationResult && message.params.inputResponses) result = options.continuationResult;
        if (options.failedTool === message.params.name) result = { resultType: 'complete', isError: true, content: [] };
        if (options.missingResultTypeTool === message.params.name) delete result.resultType;
      } else if (message.method === 'resources/list') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          resources,
        };
      } else if (message.method === 'resources/read') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          contents: [],
        };
      } else if (message.method === 'prompts/list') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          prompts,
        };
      } else if (message.method === 'prompts/get') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete' } : {}),
          messages: [],
        };
      }
      res.statusCode = message.method?.startsWith('notifications/') ? 202 : 200;
      res.end(message.id === undefined ? '' : JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
