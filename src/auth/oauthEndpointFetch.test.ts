import * as dns from 'node:dns/promises';
import http from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createOAuthEndpointFetch,
  isPrivateOAuthAddress,
  OAUTH_RESPONSE_LIMIT,
  validateOAuthEndpoint,
} from './oauthEndpointFetch.js';

vi.mock('node:dns/promises', async (importOriginal) => ({ ...(await importOriginal<typeof dns>()), lookup: vi.fn() }));
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.resetAllMocks();
  for (const stop of close.splice(0)) await stop();
});
async function endpoint(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  close.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://127.0.0.1:${address.port}`;
}
function guarded(resource: string, overrides: Partial<Parameters<typeof createOAuthEndpointFetch>[0]> = {}) {
  return createOAuthEndpointFetch({
    resource,
    isResource: (url) => url.href === resource,
    beforeRequest: async (_url, init) => init,
    metadata: (value) => value,
    response: () => undefined,
    pinDestination: async () => undefined,
    onFailure: () => undefined,
    ...overrides,
  });
}
describe('OAuth network boundary', () => {
  it('connects to an exact configured internal HTTP hostname but rejects its discovered OAuth endpoint', async () => {
    const base = await endpoint((_req, res) => res.end('resource-ok'));
    const resource = base.replace('127.0.0.1', 'mcp-server') + '/mcp';
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const fetch = guarded(resource);
    expect(await (await fetch(resource)).text()).toBe('resource-ok');
    await expect(fetch(resource.replace('/mcp', '/metadata'))).rejects.toThrow(/OAuth/);
  });

  it('permits only the accepted same-origin SSE endpoint as another resource', async () => {
    const base = await endpoint((_req, res) => res.end('sse-ok'));
    const origin = base.replace('127.0.0.1', 'mcp-server');
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const fetch = guarded(origin + '/sse', {
      isResource: (url) => url.href === origin + '/sse' || url.href === origin + '/messages?session=1',
    });
    expect(await (await fetch(origin + '/messages?session=1', { method: 'POST' })).text()).toBe('sse-ok');
    await expect(fetch(origin + '/messages?session=2', { method: 'POST' })).rejects.toThrow(/OAuth/);
  });

  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fc00::1',
    'fe80::1',
    '2002:7f00:1::',
    '2001::1',
  ])('rejects non-public destination %s', (address) => {
    expect(isPrivateOAuthAddress(address)).toBe(true);
  });
  it('permits only the exactly configured local origin as a local exception', () => {
    expect(validateOAuthEndpoint('http://127.0.0.1:4000/token', 'http://127.0.0.1:4000/mcp').href).toBe(
      'http://127.0.0.1:4000/token',
    );
    expect(() => validateOAuthEndpoint('http://127.0.0.1:4001/token', 'http://127.0.0.1:4000/mcp')).toThrow(/OAuth/);
    expect(() => validateOAuthEndpoint('http://localhost:4000/token', 'http://127.0.0.1:4000/mcp')).toThrow(/OAuth/);
    expect(() =>
      validateOAuthEndpoint('https://user:secret@public.example/token', 'https://resource.example/mcp'),
    ).toThrow(/OAuth/);
  });
  it('permits only the explicitly pinned local issuer origin and still pins its DNS socket', async () => {
    let requests = 0;
    const base = await endpoint((_req, res) => {
      requests++;
      res.end('{}');
    });
    const issuer = base.replace('127.0.0.1', 'localhost');
    const resource = 'http://127.0.0.1:1/mcp';
    const lookup = vi.mocked(dns.lookup);
    lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    lookup.mockResolvedValueOnce([
      { address: '127.0.0.1', family: 4 },
      { address: '127.0.0.2', family: 4 },
    ] as never);
    const pin = vi.fn(async () => undefined);
    const fetch = guarded(resource, { issuer, pinDestination: pin });
    await fetch(issuer + '/token');
    expect(pin).toHaveBeenCalledWith(new URL(issuer).host, '127.0.0.1', expect.any(Object));
    await fetch(issuer + '/token');
    expect(requests).toBe(2);
    expect(pin).toHaveBeenLastCalledWith(new URL(issuer).host, '127.0.0.1,127.0.0.2', expect.any(Object));
    for (const target of [base + '/token', 'http://localhost:2/token', 'http://127.0.0.2:1/token']) {
      expect(() => validateOAuthEndpoint(target, resource, undefined, issuer)).toThrow(/OAuth/);
    }
    expect(() => validateOAuthEndpoint(issuer + '/token', resource)).toThrow(/OAuth/);
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(
      guarded(resource, { issuer: 'https://public.example' })('https://public.example/token'),
    ).rejects.toThrow(/OAuth/);
  });
  it('does not follow metadata or token redirects', async () => {
    let secretEndpoint = 0;
    const base = await endpoint((req, res) => {
      if (req.url === '/secret') secretEndpoint++;
      res.writeHead(302, { location: '/secret' });
      res.end();
    });
    const fetch = guarded(base + '/mcp');
    await expect(fetch(base + '/metadata')).rejects.toThrow(/OAuth/);
    await expect(fetch(base + '/token', { method: 'POST', body: 'code=private-code' })).rejects.toThrow(/OAuth/);
    expect(secretEndpoint).toBe(0);
  });
  it.each(['GET', 'POST'])('bounds %s metadata and registration/token response bodies', async (method) => {
    const base = await endpoint((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ payload: 'x'.repeat(OAUTH_RESPONSE_LIMIT + 1) }));
    });
    await expect(guarded(base + '/mcp')(base + '/oauth', { method })).rejects.toThrow(/OAuth/);
  });
  it('preserves Request inputs without dropping method, headers or body', async () => {
    let received: { method?: string; header?: string; body: string } | undefined;
    const base = await endpoint(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      received = { method: req.method, header: String(req.headers['x-fixture']), body };
      res.end('{}');
    });
    const request = new Request(base + '/oauth', { method: 'POST', headers: { 'x-fixture': 'yes' }, body: 'payload' });
    await guarded(base + '/mcp')(request);
    expect(received).toEqual({ method: 'POST', header: 'yes', body: 'payload' });
  });
  it('pins each resolved socket and permits changed DNS answers', async () => {
    let requests = 0;
    const base = await endpoint((_req, res) => {
      requests++;
      res.end('{}');
    });
    const url = base.replace('127.0.0.1', 'localhost');
    const lookup = vi.mocked(dns.lookup);
    lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    lookup.mockResolvedValueOnce([
      { address: '127.0.0.1', family: 4 },
      { address: '127.0.0.2', family: 4 },
    ] as never);
    const fetch = guarded(url + '/mcp');
    await fetch(url + '/metadata');
    await fetch(url + '/metadata');
    expect(requests).toBe(2);
  });
  it('rejects private DNS answers for public configured hosts without connecting', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const pin = vi.fn();
    await expect(
      guarded('https://public.example/mcp', { pinDestination: pin })('https://public.example/metadata'),
    ).rejects.toThrow(/OAuth/);
    expect(pin).not.toHaveBeenCalled();
  });
  it('sanitizes provider failures instead of retaining echoed secrets', async () => {
    const base = await endpoint((_req, res) => {
      res.statusCode = 400;
      res.end(
        JSON.stringify({ error: 'invalid_grant', error_description: 'private-code private-verifier private-token' }),
      );
    });
    const response = await guarded(base + '/mcp')(base + '/token', { method: 'POST', body: 'code=private-code' });
    expect(await response.text()).toBe('{"error":"invalid_grant"}');
  });
  it('keeps an idle MCP SSE stream alive beyond the OAuth timeout', async () => {
    const base = await endpoint((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: message\ndata: first\n\n');
      const timer = setTimeout(() => res.end('event: message\ndata: second\n\n'), 10_500);
      res.on('close', () => clearTimeout(timer));
    });
    const response = await guarded(base + '/mcp')(base + '/mcp');
    expect(await response.text()).toContain('second');
  }, 15_000);
  it('bounds a slow-drip OAuth response by total elapsed time', async () => {
    const base = await endpoint((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"data":"');
      const interval = setInterval(() => res.write('x'), 100);
      res.on('close', () => clearInterval(interval));
    });
    const start = Date.now();
    await expect(guarded(base + '/mcp')(base + '/metadata')).rejects.toThrow(/OAuth/);
    expect(Date.now() - start).toBeLessThan(12_000);
  }, 15_000);
});
