import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGE_PINS, PROFILES } from './constants.mjs';

async function installedVersion(packageName) {
  let directory = dirname(fileURLToPath(import.meta.resolve(packageName)));
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (metadata.name === packageName && typeof metadata.version === 'string') return metadata.version;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    directory = dirname(directory);
  }
  throw new Error('PACKAGE_METADATA_INVALID');
}

function hasFunctions(module, names) {
  return names.every((name) => typeof module[name] === 'function');
}

export async function selfCheck() {
  const packages = Object.fromEntries(
    await Promise.all(Object.keys(PACKAGE_PINS).map(async (name) => [name, await installedVersion(name)])),
  );
  const [v1Client, v1ClientStdio, v1ClientHttp, v1ClientSse, v1Server, v1ServerStdio, v1ServerHttp, v1ServerSse] =
    await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
      import('@modelcontextprotocol/sdk/client/sse.js'),
      import('@modelcontextprotocol/sdk/server/mcp.js'),
      import('@modelcontextprotocol/sdk/server/stdio.js'),
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
      import('@modelcontextprotocol/sdk/server/sse.js'),
    ]);
  const [v2Client, v2ClientStdio, v2Server, v2ServerStdio, v2Node, v2Legacy] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio'),
    import('@modelcontextprotocol/server'),
    import('@modelcontextprotocol/server/stdio'),
    import('@modelcontextprotocol/node'),
    import('@modelcontextprotocol/server-legacy/sse'),
  ]);
  const exportsValid = [
    hasFunctions(v1Client, ['Client']),
    hasFunctions(v1ClientStdio, ['StdioClientTransport']),
    hasFunctions(v1ClientHttp, ['StreamableHTTPClientTransport']),
    hasFunctions(v1ClientSse, ['SSEClientTransport']),
    hasFunctions(v1Server, ['McpServer']),
    hasFunctions(v1ServerStdio, ['StdioServerTransport']),
    hasFunctions(v1ServerHttp, ['StreamableHTTPServerTransport']),
    hasFunctions(v1ServerSse, ['SSEServerTransport']),
    hasFunctions(v2Client, ['Client', 'SSEClientTransport', 'StreamableHTTPClientTransport']),
    hasFunctions(v2ClientStdio, ['StdioClientTransport']),
    hasFunctions(v2Server, ['createMcpHandler', 'McpServer']),
    hasFunctions(v2ServerStdio, ['serveStdio']),
    hasFunctions(v2Node, ['localhostHostValidation', 'localhostOriginValidation', 'toNodeHandler']),
    hasFunctions(v2Legacy, ['SSEServerTransport']),
  ].every(Boolean);
  const versionsValid = Object.entries(PACKAGE_PINS).every(([name, version]) => packages[name] === version);

  return {
    kind: 'self-check',
    ok: exportsValid && versionsValid,
    packages,
    profiles: PROFILES,
    checks: { exports: exportsValid, versions: versionsValid },
  };
}
