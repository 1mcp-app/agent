import { JSONRPCMessageSchema as ModernMessageSchema } from '@modelcontextprotocol/core';

import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';

import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { JSONRPCMessageSchema as LegacyMessageSchema } from '@modelcontextprotocol/sdk/types.js';

import type { OfficialConformanceRevision } from './officialRunner.js';
import { OFFICIAL_REFERENCE_COMMIT } from './referenceServer.js';

const LIMIT = 1_048_576;
const SERVER = 'official_conformance';
const fields = { tools: 'name', prompts: 'name', resources: 'uri', resourceTemplates: 'uriTemplate' } as const;
type Kind = keyof typeof fields;
type JsonObject = Record<string, unknown>;
interface Mapping {
  kind: Kind;
  upstreamIdentity: string;
  publicIdentity: string;
}
interface Fault {
  kind?: Kind;
  upstreamIdentity?: string;
  reason: string;
}
interface WireCheck {
  direction: 'client_to_gateway' | 'gateway_to_client';
  framing: 'json' | 'sse';
  schemaResult: 'valid' | 'invalid' | 'infrastructure_error';
  byteLength: number;
  digest: string;
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function digest(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function endpoint(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('canonical-target-invalid-endpoint');
  return url;
}

/** Observe JSON payloads without retaining private values or changing forwarded bytes. */
function inspectResponse(
  response: IncomingMessage,
  observe: (body: Buffer, framing: 'json' | 'sse', oversized?: boolean) => void,
): void {
  const sse = String(response.headers['content-type']).includes('text/event-stream');
  let buffer = Buffer.alloc(0);
  let oversized = false;
  const frame = (value: Buffer): void => {
    const parts: Buffer[] = [];
    const prefix = Buffer.from('data:');
    const newline = Buffer.from('\n');
    const appendDataLine = (line: Buffer): void => {
      if (!line.subarray(0, prefix.length).equals(prefix)) return;
      if (parts.length) parts.push(newline);
      // SSE removes one optional ASCII space and joins data lines with LF.
      // Slice the original bytes so invalid UTF-8 remains invalid evidence.
      parts.push(line.subarray(line[prefix.length] === 0x20 ? prefix.length + 1 : prefix.length));
    };
    let start = 0;
    for (let end = 0; end < value.length; end++) {
      if (value[end] !== 0x0a && value[end] !== 0x0d) continue;
      appendDataLine(value.subarray(start, end));
      if (end + 1 < value.length && value[end] === 0x0d && value[end + 1] === 0x0a) end++;
      start = end + 1;
    }
    appendDataLine(value.subarray(start));
    const data = Buffer.concat(parts);
    if (data.length) observe(data, 'sse', oversized);
    else if (oversized) observe(Buffer.alloc(0), 'sse', true);
    oversized = false;
  };
  response.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (sse) {
      let match: RegExpExecArray | null;
      while ((match = /\r\n\r\n|\n\n|\r\r/u.exec(buffer.toString('latin1')))) {
        frame(buffer.subarray(0, match.index));
        buffer = buffer.subarray(match.index + match[0].length);
      }
    }
    if (buffer.byteLength > LIMIT) {
      buffer = buffer.subarray(-3);
      oversized = true;
    }
  });
  response.once('end', () => {
    if (sse) {
      if (buffer.length || oversized) frame(buffer);
    } else if (buffer.length || oversized) observe(buffer, 'json', oversized);
  });
}

async function discover(
  url: URL,
  revision: OfficialConformanceRevision,
  accessToken?: string,
): Promise<Record<Kind, unknown[]>> {
  let session: string | undefined;
  let id = 0;
  const rpc = (method: string, params: JsonObject = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method,
        params:
          revision === '2026-07-28'
            ? {
                ...params,
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': revision,
                  'io.modelcontextprotocol/clientInfo': { name: 'canonical-target-discovery', version: '1' },
                  'io.modelcontextprotocol/clientCapabilities': {},
                },
              }
            : params,
      });
      const request = httpRequest(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': revision,
            ...(revision === '2026-07-28' ? { 'mcp-method': method } : {}),
            ...(session ? { 'mcp-session-id': session } : {}),
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          },
        },
        (response) => {
          session =
            typeof response.headers['mcp-session-id'] === 'string' ? response.headers['mcp-session-id'] : session;
          let resolved = false;
          inspectResponse(response, (payload, _framing, oversized) => {
            if (resolved) return;
            try {
              if (oversized) throw new Error('oversized');
              const envelope: unknown = JSON.parse(payload.toString('utf8'));
              if (!object(envelope) || envelope.id !== requestId) return;
              if (envelope.error || !object(envelope.result)) throw new Error('rejected');
              resolved = true;
              resolve(envelope.result);
              response.destroy();
            } catch {
              reject(new Error('canonical-target-discovery-rejected'));
              response.destroy();
            }
          });
          response.once('end', () => {
            if (!resolved) reject(new Error('canonical-target-discovery-empty'));
          });
          response.once('error', () => {
            if (!resolved) reject(new Error('canonical-target-discovery-failed'));
          });
        },
      );
      request.setTimeout(10_000, () => request.destroy(new Error('canonical-target-discovery-timeout')));
      request.once('error', () => reject(new Error('canonical-target-discovery-failed')));
      request.end(body);
    });
  const result = {} as Record<Kind, unknown[]>;
  try {
    if (revision === '2025-11-25')
      await rpc('initialize', {
        protocolVersion: revision,
        capabilities: {},
        clientInfo: { name: 'canonical-target-discovery', version: '1' },
      });
    for (const kind of Object.keys(fields) as Kind[]) {
      const method = kind === 'resourceTemplates' ? 'resources/templates/list' : `${kind}/list`;
      const items: unknown[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await rpc(method, cursor ? { cursor } : {});
        if (!object(page) || !Array.isArray(page[kind])) throw new Error('canonical-target-inventory-invalid');
        items.push(...page[kind]);
        if (items.length > 1000) throw new Error('canonical-target-inventory-limit');
        cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
        if (cursor && seen.has(cursor)) throw new Error('canonical-target-inventory-cursor');
        if (cursor) seen.add(cursor);
      } while (cursor);
      // Retained only internally; public evidence contains mapping identities, never full source objects.
      result[kind] = items;
    }
    return result;
  } finally {
    if (session)
      await new Promise<void>((resolve) => {
        const request = httpRequest(
          url,
          { method: 'DELETE', headers: { 'mcp-session-id': session, 'mcp-protocol-version': revision } },
          (response) => {
            response.resume();
            response.once('end', resolve);
          },
        );
        request.setTimeout(1000, () => request.destroy());
        request.once('error', () => resolve());
        request.end();
      });
  }
}

function mapInventories(
  reference: Record<Kind, unknown[]>,
  gateway: Record<Kind, unknown[]>,
): { mappings: Mapping[]; faults: Fault[] } {
  const mappings: Mapping[] = [];
  const faults: Fault[] = [];
  for (const kind of Object.keys(fields) as Kind[]) {
    const identities = new Set<string>();
    for (const item of reference[kind]) {
      const identity = object(item) ? item[fields[kind]] : undefined;
      if (typeof identity !== 'string' || !identity) {
        faults.push({ kind, reason: 'reference-identity-invalid' });
        continue;
      }
      if (identities.has(identity)) {
        faults.push({ kind, upstreamIdentity: identity, reason: 'reference-identity-ambiguous' });
        continue;
      }
      identities.add(identity);
      const matches = gateway[kind].filter((candidate) => {
        if (!object(candidate) || !object(candidate._meta)) return false;
        const route = candidate._meta['app.1mcp/route'];
        return object(route) && route.kind === kind && route.server === SERVER && route.upstreamIdentity === identity;
      });
      if (matches.length !== 1) {
        faults.push({
          kind,
          upstreamIdentity: identity,
          reason: matches.length ? 'mapping-ambiguous' : 'mapping-missing',
        });
        continue;
      }
      const identityValue = (matches[0] as JsonObject)[fields[kind]];
      if (typeof identityValue !== 'string' || !identityValue) {
        faults.push({ kind, upstreamIdentity: identity, reason: 'public-identity-invalid' });
        continue;
      }
      mappings.push({ kind, upstreamIdentity: identity, publicIdentity: identityValue });
    }
  }
  // A public identity shared by different canonical identities cannot qualify either mapping.
  const collisions = new Set(
    mappings.filter((mapping) =>
      mappings.some(
        (other) => other !== mapping && other.kind === mapping.kind && other.publicIdentity === mapping.publicIdentity,
      ),
    ),
  );
  for (const mapping of collisions)
    faults.push({
      kind: mapping.kind,
      upstreamIdentity: mapping.upstreamIdentity,
      reason: 'public-identity-ambiguous',
    });
  return {
    mappings: mappings.filter(
      (mapping) =>
        !collisions.has(mapping) &&
        !faults.some((fault) => fault.kind === mapping.kind && fault.upstreamIdentity === mapping.upstreamIdentity),
    ),
    faults,
  };
}

/** Locate only semantic identity tokens; all other input bytes remain verbatim. JSON.parse validates the whole frame first. */
function valueEnd(source: string, start: number): number {
  if (source[start] === '"') {
    for (let index = start + 1; index < source.length; index++) {
      if (source[index] === '\\') index++;
      else if (source[index] === '"') return index + 1;
    }
  }
  if (source[start] === '{' || source[start] === '[') {
    let depth = 1;
    for (let index = start + 1; index < source.length; index++) {
      if (source[index] === '"') index = valueEnd(source, index) - 1;
      else if (source[index] === '{' || source[index] === '[') depth++;
      else if (source[index] === '}' || source[index] === ']') {
        if (--depth === 0) return index + 1;
      }
    }
  }
  const end = source.slice(start).search(/[\s,}\]]/u);
  return end < 0 ? source.length : start + end;
}
function propertyRange(source: string, start: number, key: string): [number, number] | undefined {
  if (source[start] !== '{') return undefined;
  const matches: [number, number][] = [];
  let index = start + 1;
  while (index < source.length) {
    while (/[\s,]/u.test(source[index] ?? '')) index++;
    if (source[index] === '}') break;
    const keyEnd = valueEnd(source, index);
    const name: unknown = JSON.parse(source.slice(index, keyEnd));
    index = keyEnd;
    while (/[\s:]/u.test(source[index] ?? '')) index++;
    const end = valueEnd(source, index);
    if (name === key) matches.push([index, end]);
    index = end;
  }
  return matches.length === 1 ? matches[0] : undefined;
}
function identityRange(source: string, path: string[]): [number, number] | undefined {
  let start = source.search(/\S/u);
  let range: [number, number] | undefined;
  for (const key of path) {
    range = propertyRange(source, start, key);
    if (!range) return undefined;
    start = range[0];
  }
  return range;
}
function rewrite(source: string, mappings: Mapping[], faults: Fault[]): { body: string; from?: string; to?: string } {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    return { body: source };
  }
  if (!object(input) || !object(input.params)) return { body: source };
  let kind: Kind;
  let path: string[];
  if (input.method === 'tools/call') {
    kind = 'tools';
    path = ['params', 'name'];
  } else if (input.method === 'prompts/get') {
    kind = 'prompts';
    path = ['params', 'name'];
  } else if (['resources/read', 'resources/subscribe', 'resources/unsubscribe'].includes(String(input.method))) {
    kind = 'resources';
    path = ['params', 'uri'];
  } else if (input.method === 'completion/complete' && object(input.params.ref)) {
    if (input.params.ref.type === 'ref/prompt') {
      kind = 'prompts';
      path = ['params', 'ref', 'name'];
    } else if (input.params.ref.type === 'ref/resource') {
      kind = 'resourceTemplates';
      path = ['params', 'ref', 'uri'];
    } else return { body: source };
  } else return { body: source };
  const range = identityRange(source, path);
  if (!range) return { body: source };
  const from: unknown = JSON.parse(source.slice(...range));
  if (typeof from !== 'string') return { body: source };
  let candidates = mappings
    .filter((mapping) => mapping.kind === kind && mapping.upstreamIdentity === from)
    .map((mapping) => mapping.publicIdentity);
  if (!candidates.length && kind === 'resources') {
    candidates = mappings
      .filter((mapping) => mapping.kind === 'resourceTemplates')
      .flatMap((mapping) => {
        try {
          const values = new UriTemplate(mapping.upstreamIdentity).match(from);
          if (!values) return [];
          // Transfer concrete URI bytes only through the exact shape of this owned advertised template.
          // SDK expand() would double-encode captured percent escapes.
          if (!mapping.publicIdentity.endsWith(mapping.upstreamIdentity)) {
            faults.push({
              kind,
              upstreamIdentity: mapping.upstreamIdentity,
              reason: 'template-projection-unsupported',
            });
            return [];
          }
          const publicTemplate = new UriTemplate(mapping.publicIdentity);
          const projected = mapping.publicIdentity.slice(0, -mapping.upstreamIdentity.length) + from;
          const verified = publicTemplate.match(projected);
          if (!verified || publicTemplate.variableNames.some((name) => verified[name] !== values[name])) return [];
          return [projected];
        } catch {
          return [];
        }
      });
  }
  if (candidates.length !== 1) {
    // Unknown suite inputs (including negative probes) remain untouched.
    if (candidates.length > 1) faults.push({ kind, upstreamIdentity: from, reason: 'template-instance-ambiguous' });
    return { body: source };
  }
  const to = candidates[0];
  return { body: source.slice(0, range[0]) + JSON.stringify(to) + source.slice(range[1]), from, to };
}

export async function startCanonicalGatewayTarget(options: {
  root: string;
  gatewayEndpoint: string;
  referenceEndpoint: string;
  revision: OfficialConformanceRevision;
  outputDirectory: string;
  gatewayAccessToken?: string;
}): Promise<{ endpoint: string; isQualified(): boolean; rejectCredentialConflict(): void; close(): Promise<void> }> {
  const target = endpoint(options.gatewayEndpoint);
  // Only the configured, validated loopback endpoint supplies request authority.
  const trustedAuthority = Object.freeze({
    protocol: target.protocol,
    hostname: target.hostname === '[::1]' ? '::1' : target.hostname,
    port: target.port ? Number(target.port) : undefined,
  });
  const reference = endpoint(options.referenceEndpoint);
  const accessToken = options.gatewayAccessToken;
  if (
    accessToken !== undefined &&
    (options.revision !== '2026-07-28' || !/^[A-Za-z0-9._~-]{1,4096}$/u.test(accessToken))
  )
    throw new Error('canonical-target-invalid-auth-context');
  const directory = join(options.root, 'test/conformance/official/fixtures/reference');
  const source = await readFile(join(directory, 'everything-server.mjs'));
  const provenance: unknown = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'));
  if (
    !object(provenance) ||
    provenance.commit !== OFFICIAL_REFERENCE_COMMIT ||
    digest(source) !== `sha256:${String(provenance.generatedSha256)}`
  )
    throw new Error('canonical-target-reference-integrity-invalid');
  const wireChecks: WireCheck[] = [];
  const { mappings, faults } = mapInventories(
    await discover(reference, options.revision),
    await discover(target, options.revision, accessToken),
  );
  const report = () => ({
    schemaVersion: 1,
    target: '1mcp-advertised-identities',
    revision: options.revision,
    adaptation: accessToken ? 'input-identities-and-configured-authorization' : 'input-identities-only',
    gatewayAuthentication: {
      mode: accessToken ? 'configured-bearer' : 'anonymous',
      credentialConfigured: accessToken !== undefined,
    },
    output: 'unchanged',
    referenceCommit: OFFICIAL_REFERENCE_COMMIT,
    referenceDigest: digest(source),
    discovery: 'reference-and-gateway-catalogs-before-scored-scenarios',
    discoveryScope: 'preloads-shared-catalogs-and-closes-discovery-sessions; does-not-prove-cold-cache-behavior',
    qualified: faults.length === 0,
    mappings,
    faults,
    wireChecks,
  });
  const persist = async (): Promise<void> => {
    const payload = report();
    const output = join(options.outputDirectory, 'official-targets');
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(
      join(output, `server.${options.revision}.json`),
      `${JSON.stringify({ ...payload, digest: digest(JSON.stringify(payload)) }, null, 2)}\n`,
      { mode: 0o600 },
    );
  };
  await persist();
  const schema = options.revision === '2026-07-28' ? ModernMessageSchema : LegacyMessageSchema;
  const observe = (
    direction: WireCheck['direction'],
    body: Buffer,
    framing: WireCheck['framing'],
    oversized = false,
  ): void => {
    let schemaResult: WireCheck['schemaResult'] = 'invalid';
    try {
      if (oversized) schemaResult = 'infrastructure_error';
      else if (isUtf8(body) && schema.safeParse(JSON.parse(body.toString('utf8'))).success) schemaResult = 'valid';
    } catch {
      /* Retain malformed payloads as invalid, not successful adaptation. */
    }
    wireChecks.push({ direction, framing, schemaResult, byteLength: body.byteLength, digest: digest(body) });
  };
  const sockets = new Set<Socket>();
  const active = new Set<ReturnType<typeof httpRequest>>();
  const server = createServer((incoming, outgoing) => {
    const forward = (body?: Buffer, transformed?: ReturnType<typeof rewrite>): void => {
      let destination: URL;
      try {
        destination = new URL(incoming.url ?? '/', target);
        if (destination.origin !== target.origin || destination.username || destination.password)
          throw new Error('invalid');
      } catch {
        outgoing.writeHead(400).end();
        incoming.resume();
        return;
      }
      const headers = [...incoming.rawHeaders];
      if (accessToken) {
        if (headers.some((header, index) => index % 2 === 0 && header.toLowerCase() === 'authorization')) {
          faults.push({ reason: 'authentication-header-conflict' });
          outgoing.writeHead(400).end();
          incoming.resume();
          return;
        }
        // The credential belongs only to the fixed gateway origin validated above, after the capture tap.
        headers.push('Authorization', `Bearer ${accessToken}`);
      }
      if (transformed?.from !== undefined)
        for (let index = 0; index < headers.length; index += 2) {
          const key = headers[index].toLowerCase();
          if (key === 'mcp-name' && headers[index + 1] === transformed.from) headers[index + 1] = transformed.to!;
          if (key === 'content-length') headers[index + 1] = String(body!.byteLength);
        }
      const upstream = httpRequest(
        {
          ...trustedAuthority,
          path: destination.pathname + destination.search,
          method: incoming.method,
          headers,
        },
        (response) => {
          inspectResponse(response, (payload, framing, oversized) =>
            observe('gateway_to_client', payload, framing, oversized),
          );
          outgoing.writeHead(response.statusCode ?? 502, response.statusMessage, response.rawHeaders);
          response.pipe(outgoing);
          response.once('error', () => outgoing.destroy());
        },
      );
      active.add(upstream);
      upstream.once('close', () => active.delete(upstream));
      upstream.once('error', () => {
        if (outgoing.headersSent) outgoing.destroy();
        else outgoing.writeHead(502).end();
      });
      outgoing.once('close', () => upstream.destroy());
      incoming.once('error', () => upstream.destroy());
      if (body !== undefined) {
        observe('client_to_gateway', body, 'json');
        upstream.end(body);
      } else incoming.pipe(upstream);
    };
    if (incoming.method !== 'POST') {
      forward();
      return;
    }
    let chunks: Buffer[] = [];
    let length = 0;
    let passthrough = false;
    incoming.on('data', (chunk: Buffer) => {
      if (passthrough) return;
      chunks.push(chunk);
      length += chunk.byteLength;
      if (length > LIMIT) {
        passthrough = true;
        faults.push({ reason: 'request-inspection-limit' });
        observe('client_to_gateway', Buffer.alloc(0), 'json', true);
        incoming.pause();
        // Put the bounded prefix back before piping the rest without transformation.
        incoming.removeAllListeners('data');
        incoming.unshift(Buffer.concat(chunks));
        chunks = [];
        forward();
        incoming.resume();
      }
    });
    incoming.once('end', () => {
      if (passthrough) return;
      const raw = Buffer.concat(chunks);
      chunks = [];
      if (!isUtf8(raw)) {
        faults.push({ reason: 'request-encoding-uninspectable' });
        forward(raw);
        return;
      }
      const transformed = rewrite(raw.toString('utf8'), mappings, faults);
      forward(transformed.from === undefined ? raw : Buffer.from(transformed.body), transformed);
    });
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
  if (!address || typeof address === 'string') throw new Error('canonical-target-bind-failed');
  let closed: Promise<void> | undefined;
  return {
    endpoint: `http://127.0.0.1:${address.port}${target.pathname}${target.search}`,
    isQualified: () => faults.length === 0,
    rejectCredentialConflict: () => {
      faults.push({ reason: 'authentication-header-conflict' });
    },
    close: () =>
      (closed ??= (async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(new Error('canonical-target-close-failed')) : resolve()));
          for (const request of active) request.destroy();
          for (const socket of sockets) socket.destroy();
        });
        await persist();
      })()),
  };
}
