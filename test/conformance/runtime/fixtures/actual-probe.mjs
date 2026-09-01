import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = process.argv[2];
const transport = new StreamableHTTPClientTransport(new URL(endpoint));
const client = new Client({ name: 'one-mcp-matrix-probe', version: '1' }, { capabilities: {} });

try {
  await client.connect(transport);
  await client.ping();
  const listed = await client.listTools();
  if (listed.tools.length === 0) throw new Error('no-tools');
  const result = await client.callTool({
    name: listed.tools[0].name,
    arguments: { marker: 'synthetic-private-argument' },
  });
  process.stdout.write(
    `${JSON.stringify({
      fixtureId: 'typescript-sdk-v1',
      transport: 'streamable-http',
      initialized: true,
      ping: true,
      negotiatedRevision: transport.protocolVersion,
      operations: ['initialize', 'ping', 'tools/list', 'tools/call'],
      toolsCount: listed.tools.length,
      callError: result.isError === true,
    })}\n`,
  );
  await client.close();
} catch {
  try {
    await client.close();
  } catch {
    process.exitCode = 1;
  }
  process.exit(1);
}
