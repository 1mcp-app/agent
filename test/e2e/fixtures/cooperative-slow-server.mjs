import fs from 'node:fs';
import readline from 'node:readline';

const journal = process.argv[2];
const initializationGate = process.argv[3];
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  void (async () => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    let result = {};
    if (request.method === 'initialize') {
      if (initializationGate) {
        fs.appendFileSync(journal, `${JSON.stringify({ invocation: '__initialize__', event: 'start' })}\n`);
        while (!fs.existsSync(initializationGate)) await new Promise((resolve) => setTimeout(resolve, 20));
        fs.appendFileSync(journal, `${JSON.stringify({ invocation: '__initialize__', event: 'finish' })}\n`);
      }
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'cooperative-slow-fixture', version: '1.0.0' },
      };
    } else if (request.method === 'tools/list') {
      result = {
        tools: [
          {
            name: 'wait',
            description: 'Audited slow lifecycle fixture',
            inputSchema: {
              type: 'object',
              properties: { invocation: { type: 'string' }, delayMs: { type: 'number' } },
              required: ['invocation'],
            },
          },
        ],
      };
    } else if (request.method === 'tools/call') {
      const { invocation, delayMs = 0 } = request.params.arguments;
      fs.appendFileSync(journal, `${JSON.stringify({ invocation, event: 'start' })}\n`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      fs.appendFileSync(journal, `${JSON.stringify({ invocation, event: 'finish' })}\n`);
      result = { content: [{ type: 'text', text: invocation }] };
    }
    write({ jsonrpc: '2.0', id: request.id, result });
  })().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
});
