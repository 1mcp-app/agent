import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, request, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSanitizedWireCapture, startHttpWireTap } from '../capture/index.js';
import { startCanonicalGatewayTarget } from './canonicalGatewayTarget.js';
import { startOfficialReferenceServer } from './referenceServer.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
type Kind = 'tools' | 'prompts' | 'resources' | 'resourceTemplates';
type Item = Record<string, unknown>;
type Catalogs = Record<Kind, Item[]>;
const fields = { tools: 'name', prompts: 'name', resources: 'uri', resourceTemplates: 'uriTemplate' } as const;
const reference: Catalogs = {
  tools: [{ name: 'test_simple_text' }],
  prompts: [{ name: 'test_simple_prompt' }],
  resources: [{ uri: 'test://static-text' }],
  resourceTemplates: [{ uriTemplate: 'test://template/{id}/data' }],
};
function publicCatalogs(): Catalogs {
  const catalogs: Catalogs = { tools: [], prompts: [], resources: [], resourceTemplates: [] };
  for (const kind of Object.keys(fields) as Kind[]) {
    catalogs[kind] = reference[kind].map((item) => {
      const field = fields[kind];
      return {
        ...item,
        [field]: `official_conformance_1mcp_${String(item[field])}`,
        _meta: {
          'app.1mcp/route': { kind, server: 'official_conformance', upstreamIdentity: item[field] },
        },
      };
    });
  }
  return catalogs;
}
async function listen(server: Server, host: '127.0.0.1' | '::1' = '127.0.0.1'): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('listener');
  return `http://${host === '::1' ? '[::1]' : host}:${address.port}/mcp`;
}
async function setup(
  options: {
    catalogs?: Catalogs;
    referenceCatalogs?: Catalogs;
    revision?: '2025-11-25' | '2026-07-28';
    gatewayAccessToken?: string;
    gatewayHost?: '127.0.0.1' | '::1';
    respond?: (response: ServerResponse, body: string) => void;
  } = {},
) {
  const calls: Array<{ body: string; bytes: Buffer; headers: Record<string, unknown>; url?: string }> = [];
  const discovery: string[] = [];
  const discoveryHeaders: Array<{ method: unknown; headers: Record<string, unknown> }> = [];
  const gatewayDiscoveryHeaders: Array<Record<string, unknown>> = [];
  const referenceDiscoveryHeaders: Array<Record<string, unknown>> = [];
  const peer = (catalogs: Catalogs, gateway: boolean) =>
    createServer(async (incoming, outgoing) => {
      if (
        gateway &&
        options.gatewayAccessToken &&
        incoming.headers.authorization !== `Bearer ${options.gatewayAccessToken}`
      ) {
        outgoing.writeHead(401).end();
        incoming.resume();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const body = bytes.toString('utf8');
      if (incoming.method === 'DELETE') {
        outgoing.writeHead(204).end();
        return;
      }
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(body);
      } catch {
        calls.push({ body, bytes, headers: incoming.headers, url: incoming.url });
        outgoing.writeHead(400).end('malformed unchanged');
        return;
      }
      const kinds: Record<string, Kind> = {
        'tools/list': 'tools',
        'prompts/list': 'prompts',
        'resources/list': 'resources',
        'resources/templates/list': 'resourceTemplates',
      };
      if (message.method === 'initialize' || kinds[String(message.method)]) {
        discoveryHeaders.push({ method: message.method, headers: incoming.headers });
        (gateway ? gatewayDiscoveryHeaders : referenceDiscoveryHeaders).push(incoming.headers);
        if ((options.revision ?? '2026-07-28') === '2026-07-28' && incoming.headers['mcp-method'] !== message.method) {
          outgoing
            .writeHead(400, { 'content-type': 'application/json' })
            .end(
              JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'HEADER_MISMATCH' } }),
            );
          return;
        }
        discovery.push(`${gateway ? 'gateway' : 'reference'}:${String(message.method)}`);
        outgoing.writeHead(200, {
          'content-type': 'application/json',
          ...(message.method === 'initialize' ? { 'mcp-session-id': 'discovery-session' } : {}),
        });
        outgoing.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result:
              message.method === 'initialize'
                ? {}
                : { [kinds[String(message.method)]]: catalogs[kinds[String(message.method)]] },
          }),
        );
        return;
      }
      calls.push({ body, bytes, headers: incoming.headers, url: incoming.url });
      if (options.respond) {
        options.respond(outgoing, body);
        return;
      }
      outgoing.writeHead(200, { 'content-type': 'application/json' });
      outgoing.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: 'unchanged' }], resultType: 'complete' },
        }),
      );
    });
  const referenceEndpoint = await listen(peer(options.referenceCatalogs ?? reference, false));
  const gatewayEndpoint = await listen(peer(options.catalogs ?? publicCatalogs(), true), options.gatewayHost);
  const outputDirectory = await mkdtemp(join(tmpdir(), 'canonical-target-test-'));
  cleanups.push(() => rm(outputDirectory, { recursive: true, force: true }));
  const revision = options.revision ?? '2026-07-28';
  const target = await startCanonicalGatewayTarget({
    root: resolve('.'),
    referenceEndpoint,
    gatewayEndpoint,
    revision,
    outputDirectory,
    gatewayAccessToken: options.gatewayAccessToken,
  });
  cleanups.push(target.close);
  const readEvidence = async () =>
    JSON.parse(await readFile(join(outputDirectory, 'official-targets', `server.${revision}.json`), 'utf8'));
  return {
    ...target,
    gatewayEndpoint,
    calls,
    discovery,
    discoveryHeaders,
    gatewayDiscoveryHeaders,
    referenceDiscoveryHeaders,
    readEvidence,
  };
}
async function post(endpoint: string, body: string, headers: Record<string, string> = {}) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(3000),
  });
}

describe('canonical official gateway target', () => {
  it('maps the actual owned custom-header tool while preserving its argument and custom header', async () => {
    const fixture = await startOfficialReferenceServer(resolve('.'), tmpdir());
    cleanups.push(fixture.close);
    const client = new Client({ name: 'owned-header-discovery', version: '1' }, { capabilities: {} });
    let tool;
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(fixture.endpoint)));
      tool = (await client.listTools()).tools.find((entry) => entry.name === 'test_custom_header');
    } finally {
      await client.close();
    }
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toEqual({ value: { type: 'string', 'x-mcp-header': 'Value' } });
    const publicIdentity = 'official_conformance_1mcp_test_custom_header';
    const catalogs = publicCatalogs();
    catalogs.tools.push({
      ...tool,
      name: publicIdentity,
      _meta: {
        'app.1mcp/route': {
          kind: 'tools',
          server: 'official_conformance',
          upstreamIdentity: 'test_custom_header',
        },
      },
    });
    const target = await setup({ catalogs, referenceCatalogs: { ...reference, tools: [...reference.tools, tool!] } });
    const body =
      '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"test_custom_header","arguments":{"value":"Hello"}}}';
    const response = await post(target.endpoint, body, {
      'mcp-method': 'tools/call',
      'mcp-name': 'test_custom_header',
      'mcp-param-value': '=?base64?SGVsbG8=?=',
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(target.calls[0].body).toBe(body.replace('"name":"test_custom_header"', `"name":"${publicIdentity}"`));
    expect(target.calls[0].headers['mcp-name']).toBe(publicIdentity);
    expect(target.calls[0].headers['mcp-param-value']).toBe('=?base64?SGVsbG8=?=');
    await target.close();
    expect((await target.readEvidence()).faults).toEqual([]);
  });

  it('authenticates only fixed gateway discovery and forwarding without retaining the configured credential', async () => {
    const token = 'owned-configuration-token';
    const unchanged = '{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"unchanged"}]}}';
    const target = await setup({
      gatewayAccessToken: token,
      respond: (response) =>
        response.writeHead(207, { 'content-type': 'application/json', 'x-proof': 'original' }).end(unchanged),
    });
    expect(target.gatewayDiscoveryHeaders).toHaveLength(4);
    expect(target.gatewayDiscoveryHeaders.every((headers) => headers.authorization === `Bearer ${token}`)).toBe(true);
    expect(target.referenceDiscoveryHeaders.every((headers) => headers.authorization === undefined)).toBe(true);
    const body =
      '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"test_simple_text","arguments":{"opaque":"keep"},"requestState":"untouched"}}';
    const response = await post(target.endpoint, body, {
      'mcp-method': 'tools/call',
      'mcp-name': 'test_simple_text',
      'x-original': 'keep',
    });
    expect(response.status).toBe(207);
    expect(response.headers.get('x-proof')).toBe('original');
    expect(await response.text()).toBe(unchanged);
    expect(target.calls[0].body).toBe(
      body.replace('"name":"test_simple_text"', '"name":"official_conformance_1mcp_test_simple_text"'),
    );
    expect(target.calls[0].headers).toMatchObject({
      authorization: `Bearer ${token}`,
      'mcp-method': 'tools/call',
      'mcp-name': 'official_conformance_1mcp_test_simple_text',
      'x-original': 'keep',
    });
    await target.close();
    const evidence = await target.readEvidence();
    expect(evidence.gatewayAuthentication).toEqual({ mode: 'configured-bearer', credentialConfigured: true });
    expect(JSON.stringify(evidence)).not.toContain(token);
    expect(JSON.stringify(evidence)).not.toContain(createHash('sha256').update(token).digest('hex'));
  });

  it('never sends its configured credential to an absolute request target on another owned origin', async () => {
    let escaped = 0;
    const foreign = await listen(
      createServer((_incoming, response) => {
        escaped++;
        response.writeHead(200).end();
      }),
    );
    const target = await setup({ gatewayAccessToken: 'owned-token' });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(
        target.endpoint,
        { method: 'POST', path: foreign, headers: { 'content-type': 'application/json' } },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode));
        },
      );
      outgoing.once('error', reject);
      outgoing.end('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}');
    });
    expect(status).toBe(400);
    expect(escaped).toBe(0);
    expect(target.calls).toHaveLength(0);
  });

  it.each(['absolute', 'protocol-relative', 'credential'] as const)(
    'rejects an untrusted %s request target before reaching any backend',
    async (kind) => {
      let escaped = 0;
      const foreign = await listen(
        createServer((_incoming, response) => {
          escaped++;
          response.writeHead(200).end();
        }),
      );
      const target = await setup({ gatewayAccessToken: 'owned-token' });
      let path = foreign;
      if (kind === 'protocol-relative') path = foreign.slice('http:'.length);
      if (kind === 'credential') path = target.gatewayEndpoint.replace('http://', 'http://user:secret@');
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const outgoing = request(
          target.endpoint,
          { method: 'POST', path, headers: { 'content-type': 'application/json' } },
          (response) => {
            response.resume();
            response.once('end', () => resolve(response.statusCode));
          },
        );
        outgoing.once('error', reject);
        outgoing.end('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}');
      });
      expect(status).toBe(400);
      expect(escaped).toBe(0);
      expect(target.calls).toHaveLength(0);
    },
  );

  it('forwards guarded relative paths and query bytes through its fixed authority', async () => {
    const output = Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[]}}');
    const target = await setup({
      respond: (response) => response.writeHead(207, { 'content-type': 'application/json' }).end(output),
    });
    const path = '/mcp/relative%2Fpart?encoded=a%2Fb&next=%2F%2Fforeign.invalid%2F';
    const response = await post(
      new URL(path, target.endpoint).href,
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
      { 'x-path-proof': 'unchanged' },
    );
    expect(response.status).toBe(207);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(output);
    expect(target.calls[0].url).toBe(path);
    expect(target.calls[0].headers['x-path-proof']).toBe('unchanged');
  });

  it('routes the configured IPv6 loopback authority without URL brackets in request hostname options', async (context) => {
    let target: Awaited<ReturnType<typeof setup>>;
    try {
      target = await setup({ gatewayHost: '::1' });
    } catch (error) {
      if (error instanceof Error && 'code' in error && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(String(error.code))) {
        context.skip('IPv6 loopback unavailable');
        return;
      }
      throw error;
    }
    const response = await post(
      target.endpoint,
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
    );
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(1);
    expect(target.calls).toHaveLength(1);
    expect(target.calls[0].body).toContain('official_conformance_1mcp_test_simple_text');
  });

  it.each(['Authorization', 'Cookie', 'Proxy-Authorization'])(
    'rejects %s before the scored-chain tap strips it and invalidates target qualification',
    async (header) => {
      const target = await setup({ gatewayAccessToken: 'owned-configured-token' });
      const capture = createSanitizedWireCapture({
        contexts: [{ id: 'credential-conflict', negotiatedRevision: '2026-07-28' }],
        validateEnvelope: () => true,
      });
      const tap = await startHttpWireTap({
        target: target.endpoint,
        capture,
        contextId: 'credential-conflict',
        hop: 'inbound',
        authenticatedTarget: target,
      });
      cleanups.push(tap.close);
      const secret = 'driver-private-credential';
      const response = await post(
        `${tap.url}/mcp`,
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
        { [header]: secret },
      );
      expect(response.status).toBe(400);
      expect(target.calls).toHaveLength(0);
      expect(target.isQualified()).toBe(false);
      await tap.close();
      await target.close();
      const evidence = await target.readEvidence();
      expect(evidence.faults).toContainEqual({ reason: 'authentication-header-conflict' });
      expect(JSON.stringify(evidence).includes(secret)).toBe(false);
      expect(JSON.stringify(capture.snapshot()).includes(secret)).toBe(false);
      expect(evidence.wireChecks).toEqual([]);
    },
  );

  it('rejects conflicting Authorization before sending a configured grant to the gateway', async () => {
    const target = await setup({ gatewayAccessToken: 'owned-token' });
    const response = await post(
      target.endpoint,
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
      { Authorization: 'Bearer conflicting-private-token' },
    );
    expect(response.status).toBe(400);
    expect(target.calls).toHaveLength(0);
    expect(target.isQualified()).toBe(false);
    await target.close();
    const evidence = await target.readEvidence();
    expect(evidence.faults).toContainEqual({ reason: 'authentication-header-conflict' });
    expect(JSON.stringify(evidence)).not.toContain('conflicting-private-token');
  });

  it.each(['2025-11-25', '2026-07-28'] as const)(
    'discovers both %s inventories outside scored exchanges and retains qualification evidence',
    async (revision) => {
      const target = await setup({ revision });
      expect(target.isQualified()).toBe(true);
      expect(target.calls).toHaveLength(0);
      expect(target.discovery).toHaveLength(revision === '2025-11-25' ? 10 : 8);
      for (const entry of target.discoveryHeaders) {
        expect(entry.headers['mcp-protocol-version']).toBe(revision);
        expect(entry.headers['mcp-method']).toBe(revision === '2026-07-28' ? entry.method : undefined);
        expect(entry.headers['mcp-name']).toBeUndefined();
      }
      const evidence = await target.readEvidence();
      expect(evidence).toMatchObject({
        qualified: true,
        adaptation: 'input-identities-only',
        output: 'unchanged',
        mappings: expect.any(Array),
        faults: [],
        wireChecks: [],
      });
      expect(evidence.discoveryScope).toContain('does-not-prove-cold-cache');
      const { digest, ...payload } = evidence;
      expect(digest).toBe(`sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`);
    },
  );

  it('changes only the exact identity token and matching header while preserving raw arguments, metadata and continuation bytes', async () => {
    const target = await setup();
    const body =
      '{ "jsonrpc":"2.0", "id":9, "method":"tools/call", "params":{"name":"test_simple_text", "arguments": {"large":9007199254740993,"name":"test_simple_text","text":"\\u4e2d"}, "_meta":{"private":"test_simple_text"}, "inputResponses":{"name":"test_simple_text"}, "requestState":"state"}}';
    const response = await post(target.endpoint, body, {
      'Mcp-Name': 'test_simple_text',
      'Content-Length': String(Buffer.byteLength(body)),
      'Mcp-Method': 'tools/call',
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(target.calls[0].body).toBe(
      body.replace('"name":"test_simple_text"', '"name":"official_conformance_1mcp_test_simple_text"'),
    );
    expect(target.calls[0].headers).toMatchObject({
      'mcp-name': 'official_conformance_1mcp_test_simple_text',
      'mcp-method': 'tools/call',
      'content-length': String(Buffer.byteLength(target.calls[0].body)),
    });
    await target.close();
    expect((await target.readEvidence()).wireChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: 'client_to_gateway', schemaResult: 'valid' }),
        expect.objectContaining({ direction: 'gateway_to_client', schemaResult: 'valid' }),
      ]),
    );
  });

  it.each([
    ['prompts/get', { name: 'test_simple_prompt' }, 'official_conformance_1mcp_test_simple_prompt'],
    ['resources/read', { uri: 'test://static-text' }, 'official_conformance_1mcp_test://static-text'],
    [
      'resources/subscribe',
      { uri: 'test://template/a%2Fb/data' },
      'official_conformance_1mcp_test://template/a%2Fb/data',
    ],
    [
      'completion/complete',
      { ref: { type: 'ref/prompt', name: 'test_simple_prompt' }, argument: { name: 'arg', value: 'x' } },
      'official_conformance_1mcp_test_simple_prompt',
    ],
    [
      'completion/complete',
      { ref: { type: 'ref/resource', uri: 'test://template/{id}/data' }, argument: { name: 'id', value: 'a' } },
      'official_conformance_1mcp_test://template/{id}/data',
    ],
  ] as const)('routes owned %s identities using actual advertised objects', async (method, params, publicIdentity) => {
    const target = await setup();
    await (await post(target.endpoint, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }))).text();
    expect(target.calls[0].body).toContain(JSON.stringify(publicIdentity));
    expect(target.calls[0].headers).not.toHaveProperty('mcp-name');
  });

  it('preserves mismatching or missing method/name headers and unknown or malformed input bytes', async () => {
    const target = await setup();
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test_simple_text' } });
    await (await post(target.endpoint, body, { 'Mcp-Name': 'wrong', 'Mcp-Method': 'prompts/get' })).text();
    expect(target.calls[0].headers).toMatchObject({ 'mcp-name': 'wrong', 'mcp-method': 'prompts/get' });
    for (const raw of [
      body.replace('test_simple_text', 'unowned_test_simple_text'),
      '{ invalid',
      '{"params":{"name":"test_simple_text"},"params":{"name":"test_simple_text"},"method":"tools/call"}',
      JSON.stringify({ method: 'unrecognized', params: { name: 'test_simple_text' } }),
    ]) {
      await (await post(target.endpoint, raw)).text();
      expect(target.calls.at(-1)?.body).toBe(raw);
    }
  });

  it.each(['arguments', '_meta'])(
    'preserves invalid UTF-8 bytes inside %s and unqualifies adaptation',
    async (field) => {
      const target = await setup();
      const bytes = Buffer.concat([
        Buffer.from(
          `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text","${field}":{"text":"`,
        ),
        Buffer.from([0xc3, 0x28]),
        Buffer.from('"}}}'),
      ]);
      expect(target.isQualified()).toBe(true);
      const response = await fetch(target.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-name': 'test_simple_text' },
        body: Uint8Array.from(bytes),
        signal: AbortSignal.timeout(3000),
      });
      await response.text();
      expect(target.calls).toHaveLength(1);
      expect(target.calls[0].bytes).toEqual(bytes);
      expect(target.calls[0].headers['mcp-name']).toBe('test_simple_text');
      expect(target.isQualified()).toBe(false);
      await target.close();
      expect(await target.readEvidence()).toMatchObject({
        qualified: false,
        faults: expect.arrayContaining([expect.objectContaining({ reason: 'request-encoding-uninspectable' })]),
      });
    },
  );

  it.each(['missing', 'ambiguous', 'spoofed', 'suffix-only', 'collision'] as const)(
    'retains %s mapping faults and never guesses a target',
    async (defect) => {
      const catalogs = publicCatalogs();
      if (defect === 'missing') catalogs.tools = [];
      if (defect === 'ambiguous') catalogs.tools.push({ ...catalogs.tools[0], name: 'second' });
      if (defect === 'spoofed')
        catalogs.tools[0]._meta = {
          'app.1mcp/route': { kind: 'tools', server: 'attacker', upstreamIdentity: 'test_simple_text' },
        };
      if (defect === 'suffix-only') delete catalogs.tools[0]._meta;
      const referenceCatalogs = structuredClone(reference);
      if (defect === 'collision') {
        referenceCatalogs.tools.push({ name: 'second' });
        catalogs.tools.push({
          ...catalogs.tools[0],
          _meta: {
            'app.1mcp/route': { kind: 'tools', server: 'official_conformance', upstreamIdentity: 'second' },
          },
        });
      }
      const target = await setup({ catalogs, referenceCatalogs });
      expect(target.isQualified()).toBe(false);
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'test_simple_text' },
      });
      await (await post(target.endpoint, body)).text();
      expect(target.calls[0].body).toBe(body);
      expect(await target.readEvidence()).toMatchObject({
        qualified: false,
        faults: expect.arrayContaining([
          expect.objectContaining({ kind: 'tools', upstreamIdentity: 'test_simple_text' }),
        ]),
      });
    },
  );

  it('preserves unsupported advertised template shapes and retains the qualification fault', async () => {
    const catalogs = publicCatalogs();
    catalogs.resourceTemplates[0].uriTemplate = '1mcp://official_conformance/template/{id}/contents';
    const target = await setup({ catalogs });
    expect(target.isQualified()).toBe(true);
    const body = '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"test://template/a%2Fb/data"}}';
    await (await post(target.endpoint, body)).text();
    expect(target.calls[0].body).toBe(body);
    expect(target.calls[0].body).not.toContain('%252F');
    expect(target.isQualified()).toBe(false);
    await target.close();
    expect(await target.readEvidence()).toMatchObject({
      qualified: false,
      faults: expect.arrayContaining([expect.objectContaining({ reason: 'template-projection-unsupported' })]),
    });
  });

  it('leaves ambiguous owned template instances unchanged and retains the fault', async () => {
    const referenceCatalogs = structuredClone(reference);
    referenceCatalogs.resourceTemplates.push({ uriTemplate: 'test://template/{other}/data' });
    const catalogs = publicCatalogs();
    catalogs.resourceTemplates.push({
      uriTemplate: '1mcp://other/test://template/{other}/data',
      _meta: {
        'app.1mcp/route': {
          kind: 'resourceTemplates',
          server: 'official_conformance',
          upstreamIdentity: 'test://template/{other}/data',
        },
      },
    });
    const target = await setup({ catalogs, referenceCatalogs });
    const body = '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"test://template/123/data"}}';
    await (await post(target.endpoint, body)).text();
    expect(target.calls[0].body).toBe(body);
    await target.close();
    expect((await target.readEvidence()).faults).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'template-instance-ambiguous' })]),
    );
  });

  it('passes real invalid names, URIs, result fields and error envelopes through without concealing schema failure', async () => {
    const output =
      '{ "jsonrpc":"2.0", "id":null, "error":{"code":-32000,"message":"private fixture failure"}, "unexpected":"kept" }';
    const catalogs = publicCatalogs();
    catalogs.tools[0].name = 'x'.repeat(80);
    catalogs.resources[0].uri = 'invalid_uri';
    const target = await setup({
      catalogs,
      respond: (response) => {
        response.writeHead(
          422,
          [
            ['Content-Type', 'application/json'],
            ['X-Output-Proof', 'original'],
          ].flat(),
        );
        response.end(output);
      },
    });
    const response = await post(
      target.endpoint,
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
    );
    expect(response.status).toBe(422);
    expect(response.headers.get('x-output-proof')).toBe('original');
    expect(await response.text()).toBe(output);
    expect(target.calls[0].body).toContain('x'.repeat(80));
    await target.close();
    const evidence = await target.readEvidence();
    expect(evidence.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ publicIdentity: 'invalid_uri' }),
        expect.objectContaining({ publicIdentity: 'x'.repeat(80) }),
      ]),
    );
    expect(evidence.wireChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ direction: 'gateway_to_client', schemaResult: 'invalid' })]),
    );
    expect(JSON.stringify(evidence)).not.toContain('private fixture failure');
  });

  it.each([
    ['2025-11-25', 'json'],
    ['2025-11-25', 'sse'],
    ['2026-07-28', 'json'],
    ['2026-07-28', 'sse'],
  ] as const)(
    'records invalid UTF-8 %s %s output as invalid using its original payload bytes while forwarding unchanged',
    async (revision, framing) => {
      const payload = Buffer.concat([
        Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[{"type":"text","text":"'),
        Buffer.from([0xff]),
        Buffer.from('"}]}}'),
      ]);
      const output =
        framing === 'sse'
          ? Buffer.concat([Buffer.from('event: message\r\ndata: '), payload, Buffer.from('\r\n\r\n')])
          : payload;
      const target = await setup({
        revision,
        respond: (response) => {
          response.writeHead(200, { 'content-type': framing === 'sse' ? 'text/event-stream' : 'application/json' });
          response.write(output.subarray(0, output.indexOf(0xff) + 1));
          response.end(output.subarray(output.indexOf(0xff) + 1));
        },
      });
      const response = await post(
        target.endpoint,
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
      );
      expect(Buffer.from(await response.arrayBuffer())).toEqual(output);
      expect(target.calls[0].body).toContain('official_conformance_1mcp_test_simple_text');
      expect(target.isQualified()).toBe(true);
      await target.close();
      const evidence = await target.readEvidence();
      expect(evidence.faults).toEqual([]);
      expect(evidence.wireChecks).toContainEqual({
        direction: 'gateway_to_client',
        framing,
        schemaResult: 'invalid',
        byteLength: payload.byteLength,
        digest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
      });
    },
  );

  it.each(['\n', '\r\n', '\r'])(
    'extracts exact multiline SSE data bytes with %j line endings and valid UTF-8 split across chunks',
    async (newline) => {
      const first = '{"jsonrpc":"2.0",';
      const second = ' "id":1,"result":{"resultType":"complete","content":[{"type":"text","text":"中"}]}}';
      const payload = Buffer.from(first + '\n' + second);
      const output = Buffer.from(
        [': comment', 'event: message', `data: ${first}`, `data: ${second}`, '', ''].join(newline),
      );
      const split = output.indexOf(Buffer.from('中')) + 1;
      const target = await setup({
        respond: (response) => {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(output.subarray(0, split));
          response.end(output.subarray(split));
        },
      });
      const response = await post(
        target.endpoint,
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
      );
      expect(Buffer.from(await response.arrayBuffer())).toEqual(output);
      await target.close();
      expect((await target.readEvidence()).wireChecks).toContainEqual({
        direction: 'gateway_to_client',
        framing: 'sse',
        schemaResult: 'valid',
        byteLength: payload.byteLength,
        digest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
      });
    },
  );

  it.each(['', '\r', '\n', '\r\n'])(
    'flushes the final SSE data line at EOF with %j ending without a blank frame delimiter',
    async (ending) => {
      const payload = Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[]}}');
      const output = Buffer.concat([Buffer.from('data: '), payload, Buffer.from(ending)]);
      const target = await setup({
        respond: (response) => response.writeHead(200, { 'content-type': 'text/event-stream' }).end(output),
      });
      const response = await post(
        target.endpoint,
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
      );
      expect(Buffer.from(await response.arrayBuffer())).toEqual(output);
      await target.close();
      expect((await target.readEvidence()).wireChecks).toContainEqual({
        direction: 'gateway_to_client',
        framing: 'sse',
        schemaResult: 'valid',
        byteLength: payload.byteLength,
        digest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
      });
    },
  );

  it('forwards SSE immediately without altering frames and closes an unfinished stream and listener', async () => {
    let complete!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const frame = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[]}}\n\n';
    const target = await setup({
      respond: (response) => {
        response.writeHead(201, { 'content-type': 'text/event-stream', 'x-stream-proof': 'original' });
        response.write(frame);
        response.once('close', complete);
      },
    });
    const response = await post(
      target.endpoint,
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('x-stream-proof')).toBe('original');
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(Buffer.from(first.value!).toString()).toBe(frame);
    await target.close();
    await disconnected;
    await expect(fetch(target.endpoint, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    await target.close();
    expect((await target.readEvidence()).wireChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ framing: 'sse', schemaResult: 'valid' })]),
    );
  });

  it('passes an oversized body through once without transforming it and retains its inspection limit', async () => {
    const target = await setup();
    expect(target.isQualified()).toBe(true);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'test_simple_text', arguments: { text: 'x'.repeat(1_048_576) } },
    });
    await (await post(target.endpoint, body)).text();
    expect(target.calls).toHaveLength(1);
    expect(target.calls[0].body).toBe(body);
    expect(target.isQualified()).toBe(false);
    await target.close();
    expect((await target.readEvidence()).wireChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: 'client_to_gateway', schemaResult: 'infrastructure_error' }),
      ]),
    );
  });

  it.each(['json', 'sse'] as const)(
    'retains oversized %s response inspection failure without changing forwarded bytes or qualification',
    async (framing) => {
      const payload = Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { resultType: 'complete', content: [{ type: 'text', text: 'x'.repeat(1_048_576) }] },
        }),
      );
      const output = framing === 'sse' ? Buffer.concat([Buffer.from('data: '), payload, Buffer.from('\n\n')]) : payload;
      const target = await setup({
        respond: (response) => {
          response.writeHead(200, { 'content-type': framing === 'sse' ? 'text/event-stream' : 'application/json' });
          // Deliver the oversized payload before the SSE delimiter so the existing
          // incremental inspection limit is exercised rather than a complete frame.
          if (framing === 'sse')
            response.write(output.subarray(0, -2), () => {
              setTimeout(() => response.end(output.subarray(-2)), 20);
            });
          else response.end(output);
        },
      });
      const response = await post(
        target.endpoint,
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}',
      );
      expect(Buffer.from(await response.arrayBuffer())).toEqual(output);
      expect(target.isQualified()).toBe(true);
      await target.close();
      const evidence = await target.readEvidence();
      expect(evidence.faults).toEqual([]);
      expect(evidence.wireChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ direction: 'gateway_to_client', framing, schemaResult: 'infrastructure_error' }),
        ]),
      );
    },
  );

  it('preserves an unrelated Host value so rebinding and host validation probes reach the gateway', async () => {
    const target = await setup();
    await new Promise<void>((resolve, reject) => {
      const outgoing = request(
        target.endpoint,
        { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } },
        (response) => {
          response.resume();
          response.once('end', resolve);
        },
      );
      outgoing.once('error', reject);
      outgoing.end('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_simple_text"}}');
    });
    expect(target.calls[0].headers.host).toBe('evil.example');
  });
});
