import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ConfigChangeService } from '@src/domains/config-change/configChange.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfiguredServerConfigDocument } from './adminConfiguredServerService.js';
import { createAdminDomain } from './adminDomain.js';
import type { AdminOperationContext } from './adminOperationService.js';

describe('createAdminDomain', () => {
  let tempDir: string;
  let storageDir: string;
  let currentTime: Date;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-domain-'));
    storageDir = path.join(tempDir, 'state');
    currentTime = new Date('2026-07-08T00:00:00.000Z');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('wires shared admin services from explicit runtime-scope dependencies', async () => {
    const readConfigDocument = vi.fn((): ConfiguredServerConfigDocument => ({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
        },
      },
    }));

    const domain = createAdminDomain({
      runtimeScopeId: 'scope_123',
      storageDir,
      sessionTtlMs: 60 * 60 * 1000,
      now: () => currentTime,
      createOperationId: () => 'op_read',
      mutationAvailability: { available: true },
      configChangeService: fakeConfigChangeService(),
      readConfigDocument,
    });

    const result = await domain.configuredServerService.listConfiguredServers({
      context: context({ target: { type: 'configured_server_collection' } }),
    });

    expect(domain.adminService).toBeDefined();
    expect(domain.operationService).toBeDefined();
    expect(domain.configuredServerService).toBeDefined();
    expect(readConfigDocument).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      operationId: 'op_read',
      result: {
        servers: [
          {
            id: 'filesystem',
            enabled: true,
            transportSummary: { kind: 'stdio', label: 'npx' },
          },
        ],
      },
    });
  });

  function context(overrides: Partial<AdminOperationContext> = {}): AdminOperationContext {
    return {
      actor: { type: 'admin_session', accountId: 'acct_1', sessionId: 'sess_1' },
      origin: 'browser',
      target: { type: 'configured_server_collection' },
      runtimeIdentity: { runtimeScopeId: 'scope_123', runtimeVersion: '1.2.3' },
      request: { requestId: 'req_1', jsonMode: true },
      ...overrides,
    };
  }

  function fakeConfigChangeService(): ConfigChangeService {
    return {
      removeConfiguredServerTarget: vi.fn(),
      setStaticConfiguredServerTarget: vi.fn(),
      previewConfiguredServerTargetEnabledState: vi.fn(),
      setConfiguredServerTargetEnabledState: vi.fn(),
      acquireConfigLockForTest: vi.fn(),
    } as unknown as ConfigChangeService;
  }
});
