import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getGlobalConfigDir } from '@src/constants.js';

export interface RuntimeIdentity {
  identityProtocolVersion: '1';
  runtimeScopeId: string;
  externalUrl: string;
  runtimeVersion: string;
  serverTime?: string;
}

interface PersistedRuntimeIdentity {
  runtimeScopeId: string;
}

interface RuntimeIdentityServiceOptions {
  storageDir?: string;
  createId?: () => string;
  now?: () => Date;
}

interface RuntimeIdentityInput {
  externalUrl: string;
  runtimeVersion: string;
  includeServerTime?: boolean;
}

const IDENTITY_FILE = 'runtime-identity.json';

export class RuntimeIdentityService {
  private readonly storageDir: string;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: RuntimeIdentityServiceOptions = {}) {
    this.storageDir = options.storageDir ?? getGlobalConfigDir();
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  getRuntimeIdentity(input: RuntimeIdentityInput): RuntimeIdentity {
    const runtimeScopeId = this.getOrCreateRuntimeScopeId();
    const identity: RuntimeIdentity = {
      identityProtocolVersion: '1',
      runtimeScopeId,
      externalUrl: input.externalUrl,
      runtimeVersion: input.runtimeVersion,
    };

    if (input.includeServerTime ?? true) {
      identity.serverTime = this.now().toISOString();
    }

    return identity;
  }

  private getOrCreateRuntimeScopeId(): string {
    const existing = this.readPersistedIdentity();
    if (existing?.runtimeScopeId) {
      return existing.runtimeScopeId;
    }

    const runtimeScopeId = this.createId();
    this.writePersistedIdentity({ runtimeScopeId });
    return runtimeScopeId;
  }

  private readPersistedIdentity(): PersistedRuntimeIdentity | null {
    const filePath = this.getIdentityFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<PersistedRuntimeIdentity>;
      return typeof parsed.runtimeScopeId === 'string' && parsed.runtimeScopeId.length > 0
        ? { runtimeScopeId: parsed.runtimeScopeId }
        : null;
    } catch {
      return null;
    }
  }

  private writePersistedIdentity(identity: PersistedRuntimeIdentity): void {
    fs.mkdirSync(this.storageDir, { recursive: true });
    const filePath = this.getIdentityFilePath();
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(identity, null, 2));
    fs.renameSync(tempPath, filePath);
  }

  private getIdentityFilePath(): string {
    return path.join(this.storageDir, IDENTITY_FILE);
  }
}
