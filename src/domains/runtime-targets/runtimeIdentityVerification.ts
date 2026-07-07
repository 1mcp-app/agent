import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import type { RuntimeTargetObservedIdentity, StoredRuntimeTarget } from './runtimeTargetStore.js';

const RUNTIME_IDENTITY_PATH = '/.well-known/1mcp/runtime-identity';
const DEFAULT_RUNTIME_IDENTITY_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_IDENTITY_MAX_BODY_BYTES = 128 * 1024;

export interface RuntimeTargetTlsOptions {
  caFile?: string;
  insecureSkipVerify?: boolean;
}

export interface RuntimeIdentityFetchResponse {
  ok: boolean;
  status: number;
  headers?: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}

export interface RuntimeIdentityFetchInit {
  method?: string;
  headers?: Record<string, string>;
  credentials?: 'omit';
  signal?: AbortSignal;
  tls?: RuntimeTargetTlsOptions;
  maxBodyBytes?: number;
}

export type RuntimeIdentityFetch = (
  url: string,
  init: RuntimeIdentityFetchInit,
) => Promise<RuntimeIdentityFetchResponse>;

export interface RuntimeIdentityWarning {
  code: 'warning_external_url_mismatch';
  message: string;
}

export interface VerifiedRuntimeIdentity {
  identity: RuntimeTargetObservedIdentity;
  warnings: RuntimeIdentityWarning[];
}

export class RuntimeTargetIdentityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoveryCommand?: string,
  ) {
    super(message);
    this.name = 'RuntimeTargetIdentityError';
  }
}

export async function fetchRuntimeIdentity(
  baseUrl: string,
  options: { fetch?: RuntimeIdentityFetch } & RuntimeTargetTlsOptions = {},
): Promise<RuntimeTargetObservedIdentity> {
  const fetchImpl = options.fetch ?? fetchRuntimeTargetUrl;
  const tls = normalizeTlsOptions(options);
  const response = await fetchImpl(new URL(RUNTIME_IDENTITY_PATH, baseUrl).toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal: createRuntimeIdentityTimeoutSignal(),
    maxBodyBytes: DEFAULT_RUNTIME_IDENTITY_MAX_BODY_BYTES,
    ...(tls ? { tls } : {}),
  });

  if (!response.ok) {
    throw new RuntimeTargetIdentityError(
      'identity_unreachable',
      `Runtime identity endpoint returned HTTP ${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RuntimeTargetIdentityError('identity_invalid', 'Runtime identity endpoint did not return JSON');
  }
  return parseRuntimeIdentity(body);
}

export async function verifyRuntimeIdentityForTarget(input: {
  target: Pick<StoredRuntimeTarget, 'name' | 'url' | 'observedIdentity' | 'caFile' | 'insecureSkipVerify'>;
  fetch?: RuntimeIdentityFetch;
}): Promise<VerifiedRuntimeIdentity> {
  const identity = await fetchRuntimeIdentity(input.target.url, {
    fetch: input.fetch,
    caFile: input.target.caFile,
    insecureSkipVerify: input.target.insecureSkipVerify,
  });
  const expectedRuntimeScopeId = input.target.observedIdentity?.runtimeScopeId;

  if (expectedRuntimeScopeId && expectedRuntimeScopeId !== identity.runtimeScopeId) {
    throw new RuntimeTargetIdentityError(
      'identity_runtime_scope_mismatch',
      'Runtime target identity changed; refusing to use stored credentials',
      `1mcp target add ${input.target.name} ${input.target.url} --replace --accept-new-identity`,
    );
  }

  return {
    identity,
    warnings: externalUrlWarnings(input.target.url, identity),
  };
}

export async function verifyNamedRemoteTargetAttachment(input: {
  target: Pick<
    StoredRuntimeTarget,
    'name' | 'url' | 'observedIdentity' | 'caFile' | 'insecureSkipVerify' | 'insecureTlsConfirmationRequired'
  >;
  fetch?: RuntimeIdentityFetch;
  onCredentialUseReady?: (identity: RuntimeTargetObservedIdentity) => void;
}): Promise<VerifiedRuntimeIdentity> {
  if (input.target.insecureTlsConfirmationRequired) {
    throw new RuntimeTargetIdentityError(
      'target_insecure_tls_confirmation_required',
      'Runtime target uses imported insecure TLS metadata and requires confirmation before credentialed attach',
      `1mcp target verify ${input.target.name} --accept-insecure-tls`,
    );
  }
  const result = await verifyRuntimeIdentityForTarget({ target: input.target, fetch: input.fetch });
  input.onCredentialUseReady?.(result.identity);
  return result;
}

export async function fetchRuntimeTargetUrl(
  url: string,
  init: RuntimeIdentityFetchInit = {},
): Promise<RuntimeIdentityFetchResponse> {
  if (hasTlsBehavior(init.tls)) {
    return nodeFetchRuntimeTargetUrl(url, init);
  }

  if (typeof globalThis.fetch === 'function') {
    const { tls: _tls, maxBodyBytes: _maxBodyBytes, ...fetchInit } = init;
    const response = await globalThis.fetch(url, fetchInit as RequestInit);
    return init.maxBodyBytes === undefined
      ? (response as RuntimeIdentityFetchResponse)
      : boundedFetchResponse(response, init.maxBodyBytes);
  }

  return nodeFetchRuntimeTargetUrl(url, init);
}

async function nodeFetchRuntimeTargetUrl(
  url: string,
  init: RuntimeIdentityFetchInit,
): Promise<RuntimeIdentityFetchResponse> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RuntimeTargetIdentityError('identity_url_invalid', 'Runtime target URL must use http or https');
  }

  const requestOptions: https.RequestOptions = {
    method: init.method ?? 'GET',
    headers: init.headers,
    signal: init.signal,
  };

  if (parsed.protocol === 'https:') {
    if (init.tls?.caFile) {
      requestOptions.ca = readCaFile(init.tls.caFile);
    }
    if (init.tls?.insecureSkipVerify) {
      requestOptions.rejectUnauthorized = false;
    }
  }

  const client = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = client.request(parsed, requestOptions, (response) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        if (settled) {
          return;
        }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.byteLength;
        if (receivedBytes > (init.maxBodyBytes ?? DEFAULT_RUNTIME_IDENTITY_MAX_BODY_BYTES)) {
          settled = true;
          request.destroy();
          reject(
            new RuntimeTargetIdentityError(
              'identity_response_too_large',
              'Runtime identity endpoint response exceeded the maximum size',
            ),
          );
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(bufferedResponse(response.statusCode ?? 0, response.headers, Buffer.concat(chunks)));
      });
    });
    request.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
    request.end();
  });
}

function bufferedResponse(
  status: number,
  headers: http.IncomingHttpHeaders,
  body: Buffer,
): RuntimeIdentityFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const value = headers[name.toLowerCase()];
        return Array.isArray(value) ? value.join(', ') : (value ?? null);
      },
    },
    json: async () => JSON.parse(body.toString('utf8')) as unknown,
    text: async () => body.toString('utf8'),
  };
}

async function boundedFetchResponse(response: Response, maxBodyBytes: number): Promise<RuntimeIdentityFetchResponse> {
  const body = await readBoundedFetchBody(response, maxBodyBytes);
  return {
    ok: response.ok,
    status: response.status,
    headers: {
      get: (name: string) => response.headers.get(name),
    },
    json: async () => JSON.parse(body.toString('utf8')) as unknown,
    text: async () => body.toString('utf8'),
  };
}

async function readBoundedFetchBody(response: Response, maxBodyBytes: number): Promise<Buffer> {
  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > maxBodyBytes) {
      throwResponseTooLarge();
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return Buffer.concat(chunks);
      }
      const chunk = Buffer.from(value);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxBodyBytes) {
        await reader.cancel();
        throwResponseTooLarge();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
}

function throwResponseTooLarge(): never {
  throw new RuntimeTargetIdentityError(
    'identity_response_too_large',
    'Runtime identity endpoint response exceeded the maximum size',
  );
}

function readCaFile(caFile: string): Buffer {
  try {
    return fs.readFileSync(caFile);
  } catch {
    throw new RuntimeTargetIdentityError(
      'target_ca_file_unreadable',
      `Runtime target CA bundle path "${caFile}" could not be read`,
    );
  }
}

function hasTlsBehavior(tls: RuntimeTargetTlsOptions | undefined): boolean {
  return Boolean(tls?.caFile || tls?.insecureSkipVerify);
}

function normalizeTlsOptions(tls: RuntimeTargetTlsOptions): RuntimeTargetTlsOptions | undefined {
  const normalized = omitUndefined({
    caFile: tls.caFile,
    insecureSkipVerify: tls.insecureSkipVerify,
  });
  return hasTlsBehavior(normalized) ? normalized : undefined;
}

function createRuntimeIdentityTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(DEFAULT_RUNTIME_IDENTITY_TIMEOUT_MS)
    : undefined;
}

function parseRuntimeIdentity(body: unknown): RuntimeTargetObservedIdentity {
  if (!isRecord(body)) {
    throw new RuntimeTargetIdentityError('identity_invalid', 'Runtime identity response must be an object');
  }

  const identity = {
    identityProtocolVersion: body.identityProtocolVersion,
    runtimeScopeId: body.runtimeScopeId,
    externalUrl: body.externalUrl,
    runtimeVersion: body.runtimeVersion,
    serverTime: body.serverTime,
  };

  if (
    identity.identityProtocolVersion !== '1' ||
    typeof identity.runtimeScopeId !== 'string' ||
    identity.runtimeScopeId.length === 0 ||
    typeof identity.externalUrl !== 'string' ||
    identity.externalUrl.length === 0 ||
    typeof identity.runtimeVersion !== 'string' ||
    identity.runtimeVersion.length === 0
  ) {
    throw new RuntimeTargetIdentityError('identity_invalid', 'Runtime identity response is missing required fields');
  }

  return {
    identityProtocolVersion: '1',
    runtimeScopeId: identity.runtimeScopeId,
    externalUrl: identity.externalUrl,
    runtimeVersion: identity.runtimeVersion,
    serverTime: typeof identity.serverTime === 'string' ? identity.serverTime : undefined,
  };
}

function externalUrlWarnings(configuredUrl: string, identity: RuntimeTargetObservedIdentity): RuntimeIdentityWarning[] {
  return configuredUrl.replace(/\/$/, '') === identity.externalUrl.replace(/\/$/, '')
    ? []
    : [
        {
          code: 'warning_external_url_mismatch',
          message: `Runtime identity externalUrl "${identity.externalUrl}" differs from configured URL "${configuredUrl}"`,
        },
      ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}
