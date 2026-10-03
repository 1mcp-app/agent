import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';

import { oauthAuthorityError } from './oauthAuthority.js';

export const OAUTH_RESPONSE_LIMIT = 1024 * 1024;
export const OAUTH_FETCH_TIMEOUT_MS = 10_000;

export function isPrivateOAuthAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.includes(':')) {
    if (ip.startsWith('::ffff:')) return isPrivateOAuthAddress(ip.slice(7));
    // Fail closed for non-global unicast IPv6, including mapped/transition forms.
    return (
      !/^[23][0-9a-f]{3}:/.test(ip) ||
      ip.startsWith('2001:db8:') ||
      ip.startsWith('2002:') ||
      ip.startsWith('2001:0:') ||
      ip.startsWith('2001::')
    );
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function validateOAuthEndpoint(value: string, configuredResource: string, expectedOrigin?: string): URL {
  try {
    const url = new URL(value);
    const configured = new URL(configuredResource);
    const configuredLocal =
      configured.hostname === 'localhost' ||
      (isIP(configured.hostname.replace(/^\[|\]$/g, '')) !== 0 && isPrivateOAuthAddress(configured.hostname));
    const localException = configuredLocal && url.origin === configured.origin;
    if (url.username || url.password || url.hash) throw oauthAuthorityError();
    if (url.protocol !== 'https:' && !(localException && url.protocol === 'http:')) throw oauthAuthorityError();
    if (expectedOrigin && url.origin !== expectedOrigin) throw oauthAuthorityError();
    if (url.hostname === 'localhost' && !localException) throw oauthAuthorityError();
    if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateOAuthAddress(url.hostname) && !localException)
      throw oauthAuthorityError();
    return url;
  } catch {
    throw oauthAuthorityError();
  }
}

/** Pin the DNS result into the actual socket lookup, not just a preflight check. */
export function createOAuthEndpointFetch(options: {
  resource: string;
  isResource: (url: URL) => boolean;
  acceptSseEndpoint?: (endpoint: string) => void;
  beforeRequest: (url: URL, init: RequestInit) => Promise<RequestInit>;
  pinDestination: (host: string, addresses: string, init: RequestInit) => Promise<void>;
  onFailure: (resourceRequest: boolean) => void;
  response: (value: Record<string, unknown>, url: URL, init: RequestInit) => void;
  metadata: (value: Record<string, unknown>, url: URL, init: RequestInit) => Record<string, unknown>;
}): typeof fetch {
  const destinations = new Map<string, string>();
  return async (input, init) => {
    let resourceRequest = false;
    try {
      const request = input instanceof Request ? input : undefined;
      const url = validateOAuthEndpoint(request?.url ?? String(input), options.resource);
      const resource = new URL(options.resource);
      const isResource = options.isResource(url);
      resourceRequest = isResource;
      const deadline = AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS);
      const signal = init?.signal ?? request?.signal;
      const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const inputInit = request
        ? {
            method: request.method,
            headers: request.headers,
            body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
            ...init,
          }
        : init;
      const safeInit = await options.beforeRequest(url, { ...inputInit, signal: isResource ? signal : boundedSignal });
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await Promise.race([
            lookup(hostname, { all: true }),
            new Promise<never>((_resolve, reject) =>
              boundedSignal.addEventListener('abort', () => reject(oauthAuthorityError()), { once: true }),
            ),
          ]);
      const configuredLocal =
        resource.hostname === 'localhost' ||
        (isIP(resource.hostname.replace(/^\[|\]$/g, '')) !== 0 && isPrivateOAuthAddress(resource.hostname));
      const localException = configuredLocal && url.origin === resource.origin;
      if (!addresses.length || (!localException && addresses.some((item) => isPrivateOAuthAddress(item.address))))
        throw oauthAuthorityError();
      const resolved = addresses
        .map((item) => item.address)
        .sort()
        .join(',');
      const previous = destinations.get(url.host);
      if (previous && previous !== resolved) throw oauthAuthorityError();
      destinations.set(url.host, resolved);
      await options.pinDestination(url.host, resolved, safeInit);
      if (boundedSignal.aborted) throw oauthAuthorityError();
      const headers = new Headers(safeInit.headers);
      const body = safeInit.body;
      if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof URLSearchParams))
        throw oauthAuthorityError();
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const outgoing = (url.protocol === 'https:' ? https : http).request(
          url,
          {
            family: addresses[0].family,
            method: safeInit.method ?? 'GET',
            headers: Object.fromEntries(headers.entries()),
            signal: safeInit.signal ?? undefined,
            lookup: (_name, options, callback) => {
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0].address, addresses[0].family);
            },
          },
          resolve,
        );
        outgoing.on('error', reject);
        if (!isResource) outgoing.setTimeout(OAUTH_FETCH_TIMEOUT_MS, () => outgoing.destroy(oauthAuthorityError()));
        outgoing.end(body?.toString());
      });
      const status = response.statusCode ?? 500;
      if (status >= 300 && status < 400) {
        response.destroy();
        throw oauthAuthorityError();
      }
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, item));
        else if (value !== undefined) responseHeaders.set(key, value);
      }
      // MCP response streams remain streaming; OAuth metadata/token bodies are bounded.
      const oauthResponse = !isResource;
      if (!oauthResponse) {
        let stream: Readable = response;
        if (
          url.href === resource.href &&
          options.acceptSseEndpoint &&
          responseHeaders.get('content-type')?.includes('text/event-stream')
        ) {
          let pending = '';
          let observed = false;
          const parser = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              if (!observed) {
                pending += chunk.toString('utf8');
                if (pending.length > 16 * 1024) {
                  callback(oauthAuthorityError());
                  return;
                }
                const end = pending.search(/\r?\n\r?\n/);
                if (end >= 0) {
                  const event = pending.slice(0, end);
                  if (/^event:\s*endpoint$/m.test(event)) {
                    const data = /^data:\s*(.+)$/m.exec(event)?.[1];
                    try {
                      if (data) options.acceptSseEndpoint!(data);
                    } catch {
                      callback(oauthAuthorityError());
                      return;
                    }
                    observed = true;
                  }
                  pending = pending.slice(end).replace(/^\s+/, '');
                }
              }
              callback(null, chunk);
            },
          });
          stream = response.pipe(parser);
        }
        return new Response(
          status === 204 || status === 205 || status === 304
            ? null
            : (Readable.toWeb(stream) as ReadableStream<Uint8Array>),
          { status, headers: responseHeaders },
        );
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > OAUTH_RESPONSE_LIMIT) {
          response.destroy();
          throw oauthAuthorityError();
        }
        chunks.push(bytes);
      }
      let text = Buffer.concat(chunks).toString('utf8');
      if (status >= 200 && status < 300 && (safeInit.method ?? 'GET') === 'GET') {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw oauthAuthorityError();
        text = JSON.stringify(options.metadata(value as Record<string, unknown>, url, safeInit));
      }
      if (status >= 200 && status < 300 && (safeInit.method ?? 'GET') === 'POST') {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw oauthAuthorityError();
        options.response(value as Record<string, unknown>, url, safeInit);
      }
      // Provider error descriptions are untrusted and may echo secrets.
      if (status >= 400) {
        let code = 'server_error';
        try {
          const value: unknown = JSON.parse(text);
          if (
            value &&
            typeof value === 'object' &&
            'error' in value &&
            ['invalid_client', 'invalid_grant', 'invalid_scope', 'unauthorized_client', 'access_denied'].includes(
              String(value.error),
            )
          )
            code = String(value.error);
        } catch {
          /* Return bounded non-secret OAuth error. */
        }
        text = JSON.stringify({ error: code });
      }
      responseHeaders.delete('content-length');
      responseHeaders.delete('content-encoding');
      return new Response(status === 204 || status === 205 ? null : text, { status, headers: responseHeaders });
    } catch {
      options.onFailure(resourceRequest);
      throw oauthAuthorityError();
    }
  };
}
