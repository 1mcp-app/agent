import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { SanitizedWireCapture, WireDirection, WireHop } from './sanitizedWireEvidence.js';

const INSPECTION_LIMIT = 1_048_576;
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

export interface HttpWireTap {
  url: string;
  close(): Promise<void>;
}

function normalizedHeaders(headers: IncomingHttpHeaders): Record<string, string | string[] | undefined> {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    normalized[name] = typeof value === 'number' ? String(value) : value;
  }
  return normalized;
}

function forwardedHeaders(headers: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
  return Object.fromEntries([
    ...Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())),
    ['host', host],
  ]);
}

function isLoopbackTarget(target: URL): boolean {
  return (
    !target.username &&
    !target.password &&
    (target.hostname === '127.0.0.1' ||
      target.hostname === '::1' ||
      target.hostname === '[::1]' ||
      target.hostname === 'localhost')
  );
}

function trustedLoopbackHostname(target: URL): '127.0.0.1' | '::1' | 'localhost' {
  if (target.hostname === '127.0.0.1') return '127.0.0.1';
  if (target.hostname === 'localhost') return 'localhost';
  return '::1';
}

function isInspectable(headers: IncomingHttpHeaders): boolean {
  const contentType = headers['content-type'];
  const value = Array.isArray(contentType) ? contentType.join(',') : contentType;
  return value === undefined || value.toLowerCase().includes('application/json');
}

function inspectStream(
  stream: IncomingMessage,
  capture: SanitizedWireCapture,
  facts: { contextId: string; hop: WireHop; direction: WireDirection; headers: IncomingHttpHeaders },
): void {
  let length = 0;
  let chunks: Buffer[] | null = isInspectable(facts.headers) ? [] : null;
  stream.on('data', (chunk: Buffer | string) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    length += bytes.byteLength;
    if (chunks && length <= INSPECTION_LIMIT) {
      chunks.push(Buffer.from(bytes));
    } else if (length > INSPECTION_LIMIT) {
      chunks = null;
    }
  });
  stream.once('end', () => {
    const body = chunks ? Buffer.concat(chunks) : Buffer.alloc(0);
    capture.observe({
      ...facts,
      headers: normalizedHeaders(facts.headers),
      body,
      bodyByteLength: length,
    });
    body.fill(0);
    chunks = null;
  });
}

function directions(hop: Exclude<WireHop, 'stdio'>): { request: WireDirection; response: WireDirection } {
  return hop === 'inbound'
    ? { request: 'client_to_gateway', response: 'gateway_to_client' }
    : { request: 'gateway_to_peer', response: 'peer_to_gateway' };
}

export async function startHttpWireTap(options: {
  target: string;
  capture: SanitizedWireCapture;
  contextId: string;
  hop: Exclude<WireHop, 'stdio'>;
}): Promise<HttpWireTap> {
  let target: URL;
  try {
    target = new URL(options.target);
    if ((target.protocol !== 'http:' && target.protocol !== 'https:') || !isLoopbackTarget(target)) {
      throw new Error('unsupported');
    }
  } catch {
    throw new Error('Invalid wire tap target');
  }
  const requestHostname = trustedLoopbackHostname(target);
  const requestPort = target.port ? Number(target.port) : undefined;
  const direction = directions(options.hop);
  const sockets = new Set<import('node:net').Socket>();

  const server: Server = createServer((incoming, outgoing) => {
    let destination: URL;
    try {
      destination = new URL(incoming.url ?? '/', target);
      if (destination.origin !== target.origin || destination.username || destination.password) {
        throw new Error('cross-origin');
      }
    } catch {
      incoming.resume();
      outgoing.writeHead(400, { 'content-type': 'text/plain' });
      outgoing.end('wire tap destination rejected');
      return;
    }

    inspectStream(incoming, options.capture, {
      contextId: options.contextId,
      hop: options.hop,
      direction: direction.request,
      headers: incoming.headers,
    });

    const makeRequest = destination.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = makeRequest(
      {
        hostname: requestHostname,
        port: requestPort,
        path: `${destination.pathname}${destination.search}`,
        method: incoming.method,
        headers: forwardedHeaders(incoming.headers, destination.host),
      },
      (response) => {
        inspectStream(response, options.capture, {
          contextId: options.contextId,
          hop: options.hop,
          direction: direction.response,
          headers: response.headers,
        });
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.once('error', () => {
      if (!outgoing.headersSent) {
        outgoing.writeHead(502, { 'content-type': 'text/plain' });
        outgoing.end('wire tap forwarding failure');
      } else {
        outgoing.destroy();
      }
    });
    incoming.once('error', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Wire tap failed to bind');

  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(new Error('Wire tap shutdown failure')) : resolve()));
        server.closeIdleConnections();
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}
