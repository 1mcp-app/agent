import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminBackendRestartService, type RuntimeBackendRestartService } from './adminBackendRestartService.js';
import { type AdminOperationContext, AdminOperationService } from './adminOperationService.js';

describe('AdminBackendRestartService', () => {
  let storageDir: string;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-backend-restart-'));
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('restarts a selected template instance through mutation admission', async () => {
    const runtimeRestartService: RuntimeBackendRestartService = {
      restart: vi.fn(async () => ({
        targetName: 'github',
        targetType: 'template' as const,
        outcome: 'restarted' as const,
        restartedInstanceIds: ['abcdef0123456789'],
      })),
    };
    const service = new AdminBackendRestartService({
      operationService: new AdminOperationService({
        runtimeScopeId: 'scope_123',
        storageDir,
        createOperationId: () => 'op_restart',
      }),
      runtimeRestartService,
    });

    const result = await service.restartBackend({
      context: context(),
      targetName: 'github',
      selection: { mode: 'instance', instanceIdOrPrefix: 'abcdef012345' },
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      operationName: 'restartBackend',
      result: {
        targetName: 'github',
        targetType: 'template',
        outcome: 'restarted',
        restartedInstanceIds: ['abcdef0123456789'],
      },
    });
    expect(runtimeRestartService.restart).toHaveBeenCalledWith({
      targetName: 'github',
      selection: { mode: 'instance', instanceIdOrPrefix: 'abcdef012345' },
    });
  });

  function context(): AdminOperationContext {
    return {
      actor: { type: 'admin_session', accountId: 'acct_1', sessionId: 'sess_1' },
      origin: 'cli',
      target: { type: 'backend', id: 'github' },
      runtimeIdentity: { runtimeScopeId: 'scope_123', runtimeVersion: '1.2.3' },
      request: { requestId: 'req_1', jsonMode: true },
      idempotencyKey: 'restart-github',
      requestFingerprint: 'restart:fingerprint',
    };
  }
});
