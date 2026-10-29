import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beginProductFeature } from '@src/productTelemetry/index.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type AdminOperationContext, AdminOperationService } from './adminOperationService.js';

const usage = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock('@src/productTelemetry/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/productTelemetry/index.js')>()),
  beginProductFeature: vi.fn(() => usage),
}));

const directories: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  directories.splice(0).forEach((p) => fs.rmSync(p, { recursive: true, force: true }));
});
function fixture(origin: 'browser' | 'cli' = 'browser') {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-adoption-'));
  directories.push(storageDir);
  const service = new AdminOperationService({ storageDir, runtimeScopeId: 'scope' });
  const context: AdminOperationContext = {
    actor: { type: 'admin_session', accountId: 'private-account' },
    origin,
    target: { type: 'configured_server', id: 'private-backend' },
    runtimeIdentity: { runtimeScopeId: 'scope' },
    request: { requestId: 'private-request' },
    idempotencyKey: 'key',
    requestFingerprint: 'fingerprint',
  };
  return { service, context };
}
describe('runtime owned Admin adoption', () => {
  it.each(['browser', 'cli'] as const)('counts actual mutation once across %s replay', async (origin) => {
    const { service, context } = fixture(origin);
    const run = vi.fn(async () => ({ privatePayload: 'never exported' }));
    const input = { context, operationName: 'enableConfiguredServer', run };
    await service.executeMutation(input);
    await service.executeMutation(input);
    expect(run).toHaveBeenCalledOnce();
    expect(beginProductFeature).toHaveBeenCalledExactlyOnceWith('server_enable');
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('success');
  });
  it('counts an admitted execution failure without private errors', async () => {
    const { service, context } = fixture();
    await service.executeMutation({
      context,
      operationName: 'createPreset',
      run: async () => {
        throw new Error('secret');
      },
    });
    expect(beginProductFeature).toHaveBeenCalledExactlyOnceWith('preset_update');
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
  });
  it('waits for the actual mutation result before recording completion', async () => {
    const { service, context } = fixture();
    let resolve!: () => void;
    const result = new Promise<void>((done) => {
      resolve = done;
    });
    const request = service.executeMutation({ context, operationName: 'updatePreset', run: () => result });
    await vi.waitFor(() => expect(beginProductFeature).toHaveBeenCalledExactlyOnceWith('preset_update'));
    expect(usage.finish).not.toHaveBeenCalled();
    resolve();
    await request;
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('success');
  });
  it.each([
    ['applyConfiguredServerCreate', 'server_add'],
    ['applyConfiguredServerEdit', 'server_update'],
    ['deleteConfiguredServer', 'server_remove'],
    ['enableConfiguredServer', 'server_enable'],
    ['disableConfiguredServer', 'server_disable'],
    ['createPreset', 'preset_update'],
    ['updatePreset', 'preset_update'],
    ['duplicatePreset', 'preset_update'],
    ['deletePreset', 'preset_update'],
    ['createInstructionTemplate', 'template_update'],
    ['updateInstructionTemplate', 'template_update'],
    ['cloneInstructionTemplate', 'template_update'],
    ['activateInstructionTemplate', 'template_update'],
    ['importLegacyInstructionTemplate', 'template_update'],
    ['deleteInstructionTemplate', 'template_update'],
  ])('maps %s to the approved %s feature', async (operationName, feature) => {
    const { service, context } = fixture();
    await service.executeMutation({ context, operationName, run: async () => ({}) });
    expect(beginProductFeature).toHaveBeenCalledExactlyOnceWith(feature);
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('success');
  });
  it.each(['server_enable', 'server_disable'] as const)(
    'uses the explicit confirmed lifecycle action %s',
    async (productLifecycleFeature) => {
      const { service, context } = fixture();
      await service.executeMutation({
        context,
        operationName: 'applyConfiguredServerLifecycle',
        productLifecycleFeature,
        run: async () => ({}),
      });
      expect(beginProductFeature).toHaveBeenCalledExactlyOnceWith(productLifecycleFeature);
    },
  );
  it('excludes dry runs, reads, unsupported names, OAuth and backend restart', async () => {
    const { service, context } = fixture();
    const run = async () => ({ ok: true });
    await service.executeDryRun({ context, operationName: 'createPreset', run });
    await service.executeReadOnly({ context, operationName: 'createPreset', run });
    for (const operationName of [
      'private-arbitrary-name',
      'authorizeBackendOAuth',
      'restartBackendOAuth',
      'restartBackend',
    ]) {
      await service.executeMutation({ context, operationName, run });
    }
    expect(beginProductFeature).not.toHaveBeenCalled();
  });
  it('excludes rejected confirmation and invalid runtime scope', async () => {
    const { service, context } = fixture();
    await service.executeMutation({
      context,
      operationName: 'deletePreset',
      confirmationRequirements: [{ code: 'confirm', expected: true }],
      run: async () => {},
    });
    await service.executeMutation({
      context: { ...context, runtimeIdentity: { runtimeScopeId: 'wrong' } },
      operationName: 'deletePreset',
      run: async () => {},
    });
    expect(beginProductFeature).not.toHaveBeenCalled();
  });
});
