import path from 'node:path';

import { ConfigManager } from '@src/config/configManager.js';
import { getBackgroundLaunchConfigPath, readBackgroundLaunchConfig } from '@src/core/server/backgroundLaunchConfig.js';
import {
  claimRuntimeScope,
  RuntimeScopeOwnedError,
  verifyRuntimeScopeOwnership,
} from '@src/core/server/runtimeScopeOwnership.js';
import { setupServer } from '@src/server.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serveCommand, type ServeOptions } from './serve.js';
import { runServeBackgroundSupervisor } from './serveBackground.js';

const ownershipHandle = { record: { claimId: 'claim-1' }, release: vi.fn() };
const backgroundMocks = vi.hoisted(() => ({
  runServeBackground: vi.fn(),
  runServeBackgroundSupervisor: vi.fn(),
}));

vi.mock('@src/core/server/runtimeScopeOwnership.js', () => ({
  claimRuntimeScope: vi.fn(() => ownershipHandle),
  verifyRuntimeScopeOwnership: vi.fn(),
  RuntimeScopeOwnedError: class RuntimeScopeOwnedError extends Error {},
}));
vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: vi.fn(() => {
      throw new Error('config loading reached');
    }),
  },
}));
vi.mock('@src/core/server/backgroundLaunchConfig.js', () => ({
  getBackgroundLaunchConfigPath: vi.fn((configDir: string) => path.join(configDir, 'background-launch.json')),
  readBackgroundLaunchConfig: vi.fn(),
}));
vi.mock('@src/server.js', () => ({ setupServer: vi.fn() }));
vi.mock('@src/logger/logger.js');
vi.mock('./serveBackground.js', () => backgroundMocks);

describe('serveCommand Runtime Scope ownership', () => {
  const scope = path.join(process.cwd(), '.tmp-serve-ownership');
  const originalExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it.each([
    ['http', 'foreground-http'],
    ['stdio', 'foreground-stdio'],
  ] as const)('claims ordinary foreground %s before loading runtime config', async (transport, kind) => {
    await serveCommand({
      'config-dir': scope,
      transport,
    } as ServeOptions);

    expect(claimRuntimeScope).toHaveBeenCalledWith(scope, { kind });
    expect(ConfigManager.getInstance).toHaveBeenCalledOnce();
    expect(setupServer).not.toHaveBeenCalled();
    expect(ownershipHandle.release).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('fails non-zero before config loading when the scope is already owned', async () => {
    vi.mocked(claimRuntimeScope).mockImplementationOnce(() => {
      throw new RuntimeScopeOwnedError(path.join(scope, 'runtime.owner'), 'owned', null);
    });

    await serveCommand({ 'config-dir': scope, transport: 'http' } as ServeOptions);

    expect(ConfigManager.getInstance).not.toHaveBeenCalled();
    expect(setupServer).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('verifies the supervisor claim instead of claiming again in a supervised worker', async () => {
    await serveCommand({
      'config-dir': scope,
      transport: 'http',
      'runtime-owner-claim-id': 'supervisor-claim',
      'background-launch-config': getBackgroundLaunchConfigPath(scope),
    } as ServeOptions);

    expect(verifyRuntimeScopeOwnership).toHaveBeenCalledWith(scope, 'supervisor-claim', 'background-supervisor');
    expect(claimRuntimeScope).not.toHaveBeenCalled();
    expect(ConfigManager.getInstance).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('rejects a launch snapshot whose generation does not match the verified supervisor claim', async () => {
    vi.mocked(ConfigManager.getInstance).mockReturnValueOnce({} as never);
    vi.mocked(readBackgroundLaunchConfig).mockReturnValueOnce({
      version: 1,
      claimId: 'replacement-claim',
      appConfig: {},
    });

    await serveCommand({
      'config-dir': scope,
      transport: 'http',
      'runtime-owner-claim-id': 'supervisor-claim',
      'background-launch-config': getBackgroundLaunchConfigPath(scope),
    } as ServeOptions);

    expect(verifyRuntimeScopeOwnership).toHaveBeenCalledWith(scope, 'supervisor-claim', 'background-supervisor');
    expect(readBackgroundLaunchConfig).toHaveBeenCalledOnce();
    expect(setupServer).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('rejects a background launch snapshot outside an authorized supervised worker', async () => {
    await serveCommand({
      'config-dir': scope,
      transport: 'http',
      'background-launch-config': '/tmp/forged-background-launch.json',
    } as ServeOptions);

    expect(verifyRuntimeScopeOwnership).not.toHaveBeenCalled();
    expect(claimRuntimeScope).not.toHaveBeenCalled();
    expect(ConfigManager.getInstance).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('routes the background bootstrap process to the persistent supervisor', async () => {
    await serveCommand({
      'config-dir': scope,
      'background-bootstrap': true,
      transport: 'http',
    } as ServeOptions);

    expect(runServeBackgroundSupervisor).toHaveBeenCalledOnce();
    expect(claimRuntimeScope).not.toHaveBeenCalled();
    expect(verifyRuntimeScopeOwnership).not.toHaveBeenCalled();
    expect(ConfigManager.getInstance).not.toHaveBeenCalled();
  });
});
