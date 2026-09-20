import { ChildProcess } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { type RuntimeLaunchBootstrap, waitForChildActivation } from './runtimeLaunchIpc.js';

describe('runtime launch IPC', () => {
  it('rejects and removes listeners when the child disconnects before bootstrap is sent', async () => {
    const child = new ChildProcess();
    const bootstrap: RuntimeLaunchBootstrap = {
      type: 'runtime-bootstrap',
      nonce: 'test',
      digest: 'test',
      snapshot: {
        version: 1,
        runtimeScope: '/test',
        configFilePath: '/test/mcp.json',
        mcpConfig: { mcpServers: {} },
        appConfig: {},
        explicitInputs: { version: 1, values: {} },
        runtimeEnvironment: {},
        parentEnvironment: {},
      },
      options: {},
    };
    const activation = waitForChildActivation(child, bootstrap);
    const rejected = expect(activation).rejects.toThrow('private launch channel disconnected');
    expect(() => child.emit('message', { type: 'runtime-hello' })).not.toThrow();
    await rejected;
    for (const event of ['message', 'exit', 'error', 'runtime-ipc-error']) {
      expect(child.listenerCount(event)).toBe(0);
    }
  });
});
