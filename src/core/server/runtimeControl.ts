import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { credentialReadFlags, hasSafeCredentialPermissions } from '@src/utils/filePermissions.js';

import { z } from 'zod';

import type { ServerPidInfo } from './pidFileManager.js';
import { readRuntimeScopeOwnership } from './runtimeScopeOwnership.js';

const CONTROL_FILE = 'runtime-control.json';
const LIMIT = 1024 * 1024;
const nonceSchema = z.string().min(16).max(128);
const descriptorSchema = z
  .object({
    version: z.literal(1),
    configDir: z.string(),
    claimId: nonceSchema,
    url: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === 'http:' &&
          url.hostname === '127.0.0.1' &&
          !!url.port &&
          url.pathname === '/' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }),
  })
  .strict();
export type RuntimeControlDescriptor = z.infer<typeof descriptorSchema>;
export type RuntimeControlMethod =
  'describe' | 'prepare-replacement' | 'commit-replacement' | 'operation-status' | 'stop';
const methodSchema = z.enum(['describe', 'prepare-replacement', 'commit-replacement', 'operation-status', 'stop']);
export interface RuntimeControlDescription {
  runtime: ServerPidInfo | null;
  runtimeScopeId: string;
  version: string;
  explicitInputs: unknown;
  digest: string;
  supervisorPid: number;
  state: string;
}
const descriptionSchema = z
  .object({
    runtime: z
      .object({
        pid: z.number().int().positive(),
        url: z.string().url(),
        port: z.number().int().min(1).max(65535),
        host: z.string(),
        transport: z.literal('http'),
        startedAt: z.string(),
        configDir: z.string(),
        logFile: z.string().optional(),
      })
      .passthrough()
      .nullable(),
    runtimeScopeId: z.string().min(1),
    version: z.string(),
    explicitInputs: z.unknown().optional(),
    digest: z.string(),
    supervisorPid: z.number().int().positive(),
    state: z.string(),
  })
  .passthrough();
export type RuntimeControlHandler = (
  method: RuntimeControlMethod,
  payload: unknown,
  operationId: string,
) => Promise<unknown> | unknown;

const challengeRequestSchema = z.object({ nonce: nonceSchema }).strict();
const challengeSchema = z
  .object({ nonce: nonceSchema, challenge: nonceSchema, expires: z.number().int(), signature: z.string() })
  .strict();
const requestSchema = z
  .object({
    nonce: nonceSchema,
    challenge: nonceSchema,
    expires: z.number().int(),
    method: methodSchema,
    operationId: nonceSchema,
    payload: z.unknown(),
    signature: z.string(),
  })
  .strict();
const responseSchema = z.object({ ok: z.boolean(), value: z.unknown(), signature: z.string() }).strict();

export function runtimeControlExists(configDir: string): boolean {
  try {
    fs.lstatSync(path.join(configDir, CONTROL_FILE));
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Remove runtime control descriptor and secret files when the descriptor matches the expected claim ID.
 * Deletes the secret file before unlinking the descriptor to ensure atomicity.
 * Returns true if control files do not exist or were safely removed; false on claim mismatch or error.
 */
export function cleanupRuntimeControlFiles(configDir: string, expectedClaimId: string): boolean {
  if (!runtimeControlExists(configDir)) return true;
  try {
    const raw = readPrivate(path.join(configDir, CONTROL_FILE));
    const descriptor = descriptorSchema.parse(JSON.parse(raw));
    if (descriptor.claimId !== expectedClaimId) return false;
    fs.rmSync(secretPath(configDir, expectedClaimId), { force: true });
    fs.unlinkSync(path.join(configDir, CONTROL_FILE));
    return true;
  } catch {
    return false;
  }
}

function secretPath(configDir: string, claimId: string): string {
  return path.join(configDir, `runtime-control-${createHash('sha256').update(claimId).digest('hex')}.secret`);
}

// Unlike legacy credential reads, attachment must never repair or mutate files.
function readPrivate(file: string): string {
  const dir = fs.statSync(path.dirname(file));
  const fd = fs.openSync(file, credentialReadFlags(), 0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > LIMIT) throw new Error('Invalid runtime control file');
    if (!hasSafeCredentialPermissions(dir, 0o022) || !hasSafeCredentialPermissions(stat, 0o077)) {
      throw new Error('Runtime control files require owner-only permissions');
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}
function proof(secret: string, descriptor: RuntimeControlDescriptor, purpose: string, value: unknown): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update(JSON.stringify(['1mcp-runtime-control-v1', descriptor, purpose, value]))
    .digest('base64url');
}
function verify(actual: string, expected: string): void {
  const left = Buffer.from(actual, 'base64url');
  const right = Buffer.from(expected, 'base64url');
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new Error('Runtime control authentication failed');
}
function assertOwner(descriptor: RuntimeControlDescriptor): void {
  const owner = readRuntimeScopeOwnership(descriptor.configDir);
  if (owner?.claimId !== descriptor.claimId || owner.kind !== 'background-supervisor') {
    throw new Error('Runtime control generation no longer owns this scope');
  }
}
async function readBody(stream: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > LIMIT) throw new Error('Runtime control message too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isValidChallenge(
  challenge: { nonce: string; expires: number } | undefined,
  request: { nonce: string; expires: number },
): boolean {
  if (!challenge) return false;
  if (challenge.nonce !== request.nonce) return false;
  if (challenge.expires !== request.expires) return false;
  return challenge.expires > Date.now();
}

export async function startRuntimeControl(
  configDir: string,
  claimId: string,
  handler: RuntimeControlHandler,
): Promise<{
  descriptor: RuntimeControlDescriptor;
  close: () => Promise<void>;
}> {
  configDir = fs.realpathSync(configDir);
  nonceSchema.parse(claimId);
  const directory = fs.statSync(configDir);
  if (!hasSafeCredentialPermissions(directory, 0o022)) {
    throw new Error('Runtime control directory must be owned by the current user and not writable by others');
  }
  const secret = randomBytes(32).toString('base64url');
  const challenges = new Map<string, { nonce: string; expires: number }>();
  let descriptor: RuntimeControlDescriptor;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') throw new Error('Invalid method');
      assertOwner(descriptor);
      const body = await readBody(req);
      if (req.url === '/challenge') {
        const { nonce } = challengeRequestSchema.parse(body);
        for (const [key, value] of challenges) if (value.expires <= Date.now()) challenges.delete(key);
        if (challenges.size >= 128) throw new Error('Too many challenges');
        const challenge = randomBytes(32).toString('base64url');
        const expires = Date.now() + 10_000;
        const value = { nonce, challenge, expires };
        challenges.set(challenge, { nonce, expires });
        res.end(JSON.stringify({ ...value, signature: proof(secret, descriptor, 'challenge', value) }));
        return;
      }
      if (req.url !== '/request') throw new Error('Invalid endpoint');
      const { signature, ...request } = requestSchema.parse(body);
      const challenge = challenges.get(request.challenge);
      challenges.delete(request.challenge);
      if (!isValidChallenge(challenge, request)) {
        throw new Error('Expired or consumed runtime control challenge');
      }
      verify(signature, proof(secret, descriptor, 'request', request));
      let value: unknown;
      let ok = true;
      try {
        value = await handler(request.method, request.payload, request.operationId);
      } catch {
        ok = false;
        value = 'Runtime control operation failed';
      }
      const result = { ok, value: value ?? null };
      res.end(JSON.stringify({ ...result, signature: proof(secret, descriptor, 'response', [request, result]) }));
    } catch {
      res.statusCode = 403;
      res.end('Runtime control request rejected');
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.timeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Runtime control listener unavailable');
  descriptor = { version: 1, configDir, claimId, url: `http://127.0.0.1:${address.port}/` };
  const metadata = path.join(configDir, CONTROL_FILE);
  const secretFile = secretPath(configDir, claimId);
  let createdSecret = false;
  try {
    assertOwner(descriptor);
    fs.writeFileSync(secretFile, secret, { mode: 0o600, flag: 'wx' });
    createdSecret = true;
    // Claim acquisition serializes publication; never overwrite another generation.
    fs.writeFileSync(metadata, JSON.stringify(descriptor), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    server.close();
    if (createdSecret) fs.unlinkSync(secretFile);
    throw error;
  }
  return {
    descriptor,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      if (runtimeControlExists(configDir)) {
        const current = descriptorSchema.parse(JSON.parse(readPrivate(metadata)));
        if (current.claimId === claimId && current.url === descriptor.url) fs.unlinkSync(metadata);
      }
      fs.rmSync(secretFile, { force: true });
    },
  };
}

export async function connectRuntimeControl(configDir: string): Promise<{
  descriptor: RuntimeControlDescriptor;
  request: <T = unknown>(method: RuntimeControlMethod, payload?: unknown, operationId?: string) => Promise<T>;
} | null> {
  if (!runtimeControlExists(configDir)) return null;
  configDir = fs.realpathSync(configDir);
  const descriptor = descriptorSchema.parse(JSON.parse(readPrivate(path.join(configDir, CONTROL_FILE))));
  if (descriptor.configDir !== configDir) throw new Error('Runtime control scope mismatch');
  assertOwner(descriptor);
  const secret = readPrivate(secretPath(configDir, descriptor.claimId));
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Invalid runtime control credential');
  const post = async (endpoint: string, value: unknown): Promise<unknown> => {
    const response = await fetch(new URL(endpoint, descriptor.url), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    }).catch(() => {
      throw new Error(
        'Runtime control is unreachable. Preserve ownership metadata and use the original CLI or service manager for explicit recovery.',
      );
    });
    if (!response.ok || !response.body) throw new Error('Runtime control request rejected');
    return readBody(response.body);
  };
  return {
    descriptor,
    request: async <T>(
      method: RuntimeControlMethod,
      payload: unknown = {},
      operationId: string = randomUUID(),
    ): Promise<T> => {
      assertOwner(descriptor);
      const nonce = randomBytes(32).toString('base64url');
      const { signature, ...challenge } = challengeSchema.parse(await post('challenge', { nonce }));
      if (challenge.nonce !== nonce || challenge.expires <= Date.now())
        throw new Error('Stale runtime control challenge');
      verify(signature, proof(secret, descriptor, 'challenge', challenge));
      assertOwner(descriptor);
      const request = { ...challenge, method, operationId, payload };
      const response = responseSchema.parse(
        await post('request', { ...request, signature: proof(secret, descriptor, 'request', request) }),
      );
      const result = { ok: response.ok, value: response.value };
      verify(response.signature, proof(secret, descriptor, 'response', [request, result]));
      if (!response.ok) throw new Error('Runtime control operation failed');
      if (method === 'describe') {
        const description = descriptionSchema.parse(response.value);
        if (description.runtime && fs.realpathSync(description.runtime.configDir) !== configDir) {
          throw new Error('Runtime endpoint scope mismatch');
        }
        return description as T;
      }
      return response.value as T;
    },
  };
}
