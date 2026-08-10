import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ContextData } from '@src/types/context.js';
import { createContextHash } from '@src/utils/context/contextHash.js';

import { z } from 'zod';

export const TEMPLATE_CONTEXT_CAPABILITY_FILE = 'template-context-capability.json';

export type TemplateContextTrustMode = 'verified' | 'disabled' | 'legacy';
export type TemplateContextTrustProvenance = 'verified-local' | 'legacy-unverified';

export interface TemplateContextProof {
  version: 1;
  runtimeScopeId: string;
  sessionId: string;
  contextHash: string;
  issuedAt: string;
  signature: string;
}

export interface TemplateContextCapability {
  version: 1;
  runtimeScopeId: string;
  secret: string;
}

const templateContextCapabilitySchema = z
  .object({
    version: z.literal(1),
    runtimeScopeId: z.string().min(1),
    secret: z.string().refine(isCanonicalCapabilitySecret),
  })
  .strict() satisfies z.ZodType<TemplateContextCapability>;

declare const trustedTemplateContextBrand: unique symbol;
export type TrustedTemplateContext = ContextData & {
  readonly [trustedTemplateContextBrand]: true;
};

export type TemplateContextAuthorization =
  | {
      status: 'trusted';
      provenance: TemplateContextTrustProvenance;
      context: TrustedTemplateContext;
      contextHash: string;
      runtimeScopeId?: string;
    }
  | {
      status: 'untrusted' | 'disabled';
      reason:
        | 'trust_disabled'
        | 'proof_missing'
        | 'proof_invalid'
        | 'runtime_scope_mismatch'
        | 'session_mismatch'
        | 'context_hash_mismatch'
        | 'issued_at_invalid'
        | 'proof_expired';
      contextHash: string;
      runtimeScopeId?: string;
    };

interface TemplateContextCapabilityStoreOptions {
  storageDir: string;
  runtimeScopeId?: string;
  createSecret?: () => Buffer;
}

interface CreateTemplateContextProofOptions {
  now?: () => Date;
}

interface AuthorizeTemplateContextInput {
  mode: TemplateContextTrustMode;
  context: ContextData;
  proof?: TemplateContextProof;
  capability?: TemplateContextCapability;
  transportSessionId?: string;
  maxAgeMs?: number;
  now?: () => number;
}

export class TemplateContextCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateContextCapabilityError';
  }
}

export class TemplateContextCapabilityStore {
  private readonly createSecret: () => Buffer;

  constructor(private readonly options: TemplateContextCapabilityStoreOptions) {
    this.createSecret = options.createSecret ?? (() => randomBytes(32));
  }

  getOrCreate(): TemplateContextCapability {
    const filePath = this.filePath();
    if (fs.existsSync(filePath)) {
      return this.readExisting(filePath);
    }

    fs.mkdirSync(this.options.storageDir, { recursive: true, mode: 0o700 });
    if (!this.options.runtimeScopeId) {
      throw new TemplateContextCapabilityError('runtimeScopeId is required to create a template context capability');
    }
    const capability: TemplateContextCapability = {
      version: 1,
      runtimeScopeId: this.options.runtimeScopeId,
      secret: this.createSecret().toString('base64url'),
    };
    const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;

    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(capability, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      fs.renameSync(temporaryPath, filePath);
      fs.chmodSync(filePath, 0o600);
      return capability;
    } catch (error) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Best effort cleanup after an interrupted atomic write.
      }
      if (fs.existsSync(filePath)) {
        return this.readExisting(filePath);
      }
      throw error;
    }
  }

  read(): TemplateContextCapability | null {
    const filePath = this.filePath();
    return fs.existsSync(filePath) ? this.readExisting(filePath) : null;
  }

  private readExisting(filePath: string): TemplateContextCapability {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new TemplateContextCapabilityError(`Template context capability is not a regular file: ${filePath}`);
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new TemplateContextCapabilityError(`Template context capability must be owner-only (0600): ${filePath}`);
    }

    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    } catch (error) {
      throw new TemplateContextCapabilityError(
        `Template context capability is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const parsed = templateContextCapabilitySchema.safeParse(value);
    if (
      !parsed.success ||
      (this.options.runtimeScopeId !== undefined && parsed.data.runtimeScopeId !== this.options.runtimeScopeId)
    ) {
      throw new TemplateContextCapabilityError('Template context capability does not match this Runtime Scope');
    }

    return parsed.data;
  }

  private filePath(): string {
    return path.join(this.options.storageDir, TEMPLATE_CONTEXT_CAPABILITY_FILE);
  }
}

function isCanonicalCapabilitySecret(value: string): boolean {
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length >= 32 && decoded.toString('base64url') === value;
}

export function createTemplateContextProof(
  context: ContextData,
  capability: TemplateContextCapability,
  options: CreateTemplateContextProofOptions = {},
): TemplateContextProof {
  if (!context.sessionId) {
    throw new Error('Template context proof requires a canonical sessionId');
  }

  const proof: Omit<TemplateContextProof, 'signature'> = {
    version: 1,
    runtimeScopeId: capability.runtimeScopeId,
    sessionId: context.sessionId,
    contextHash: createContextHash(context),
    issuedAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  return {
    ...proof,
    signature: signProof(proof, capability.secret),
  };
}

export function authorizeTemplateContext(input: AuthorizeTemplateContextInput): TemplateContextAuthorization {
  const contextHash = createContextHash(input.context);
  const runtimeScopeId = input.proof?.runtimeScopeId;

  if (input.mode === 'disabled') {
    return { status: 'disabled', reason: 'trust_disabled', contextHash, runtimeScopeId };
  }

  if (input.mode === 'legacy') {
    return {
      status: 'trusted',
      provenance: 'legacy-unverified',
      context: input.context as TrustedTemplateContext,
      contextHash,
      runtimeScopeId,
    };
  }

  if (!input.proof || !input.capability) {
    return { status: 'untrusted', reason: 'proof_missing', contextHash, runtimeScopeId };
  }
  if (input.proof.runtimeScopeId !== input.capability.runtimeScopeId) {
    return { status: 'untrusted', reason: 'runtime_scope_mismatch', contextHash, runtimeScopeId };
  }

  const canonicalSessionId = input.transportSessionId;
  if (
    !canonicalSessionId ||
    input.proof.sessionId !== canonicalSessionId ||
    input.context.sessionId !== canonicalSessionId
  ) {
    return { status: 'untrusted', reason: 'session_mismatch', contextHash, runtimeScopeId };
  }
  if (input.proof.contextHash !== contextHash) {
    return { status: 'untrusted', reason: 'context_hash_mismatch', contextHash, runtimeScopeId };
  }
  if (input.maxAgeMs !== undefined) {
    const issuedAt = Date.parse(input.proof.issuedAt);
    const now = (input.now ?? Date.now)();
    if (!Number.isFinite(issuedAt) || issuedAt > now + 5 * 60 * 1000) {
      return { status: 'untrusted', reason: 'issued_at_invalid', contextHash, runtimeScopeId };
    }
    if (now - issuedAt > input.maxAgeMs) {
      return { status: 'untrusted', reason: 'proof_expired', contextHash, runtimeScopeId };
    }
  }

  const { signature, ...unsignedProof } = input.proof;
  const expected = signProof(unsignedProof, input.capability.secret);
  if (!safeSignatureEqual(signature, expected)) {
    return { status: 'untrusted', reason: 'proof_invalid', contextHash, runtimeScopeId };
  }

  return {
    status: 'trusted',
    provenance: 'verified-local',
    context: input.context as TrustedTemplateContext,
    contextHash,
    runtimeScopeId,
  };
}

function signProof(proof: Omit<TemplateContextProof, 'signature'>, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(proofPayload(proof)).digest('base64url');
}

function proofPayload(proof: Omit<TemplateContextProof, 'signature'>): string {
  return [proof.version, proof.runtimeScopeId, proof.sessionId, proof.contextHash, proof.issuedAt].join('\n');
}

function safeSignatureEqual(actual: string, expected: string): boolean {
  try {
    const actualBuffer = Buffer.from(actual, 'base64url');
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
