import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { getProjectLifecycle, withProjectAdmission } from '@src/application/projectLifecycle.js';
import { createProjectOwnerCredential } from '@src/core/context/projectOwner.js';
import { createTemplateContextProof, TemplateContextCapabilityStore } from '@src/core/context/templateContextTrust.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ClientInstancePool } from '@src/core/server/clientInstancePool.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import { withHttpProjectAdmission } from '@src/transport/http/middlewares/projectAdmission.js';
import type { ContextData } from '@src/types/context.js';

import type { Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { createProjectHandler } from './projectRoutes.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-api-'));
  fs.chmodSync(directory, 0o700);
  const config = AgentConfigManager.getInstance();
  const previous = config.get('runtimeScopeStoragePath');
  config.updateConfig({ runtimeScopeStoragePath: directory });
  config.updateConfig({ auth: { ...config.get('auth'), enabled: false } });
  const capability = new TemplateContextCapabilityStore({
    storageDir: directory,
    runtimeScopeId: new RuntimeIdentityService({ storageDir: directory }).getRuntimeScopeId(),
  }).getOrCreate();
  const manager = new TemplateServerManager();
  cleanups.push(async () => {
    await manager.shutdown();
    config.updateConfig({ runtimeScopeStoragePath: previous });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const server = { getTemplateServerManager: () => manager } as unknown as ServerManager;
  const invoke = async (
    action: string,
    owner = createProjectOwnerCredential(capability),
    checkout = directory,
    waitMs?: number,
    projectSet?: ContextData['projectSet'],
  ) => {
    const context: ContextData = {
      project: { path: checkout },
      user: {},
      environment: {},
      sessionId: 'transport',
      ...(projectSet ? { projectSet } : {}),
      owner,
    };
    const proof = createTemplateContextProof(context, capability);
    let status = 200;
    let output: unknown;
    const response = Object.assign(new EventEmitter(), {
      locals: {},
      status: (code: number) => {
        status = code;
        return response;
      },
      json: (value: unknown) => {
        output = value;
        return response;
      },
    });
    await createProjectHandler(server)(
      {
        headers: { 'mcp-session-id': 'transport' },
        query: {},
        destroyed: true,
        body: { action, ...(waitMs === undefined ? {} : { waitMs }), _meta: { context, contextProof: proof } },
      } as unknown as Request,
      response as unknown as Response,
      () => {},
    );
    return { status, output };
  };
  return { invoke, capability, directory, manager, server };
}
describe('Project lifecycle HTTP controls', () => {
  it('cannot replace a drained bound target with unsigned context selecting an open checkout', async () => {
    const f = await fixture();
    const owner = createProjectOwnerCredential(f.capability);
    const context: ContextData = {
      project: { path: f.directory },
      user: {},
      environment: {},
      owner,
      sessionId: 'bound',
    };
    const binding = await f.manager.registerBindingContext('bound', context);
    await f.invoke('drain', createProjectOwnerCredential(f.capability, undefined, 'operator'));
    const open = path.join(f.directory, 'open');
    fs.mkdirSync(open);
    let invoked = false;
    let status = 200;
    const response = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    };
    await withHttpProjectAdmission(f.server, async () => {
      invoked = true;
    })(
      {
        headers: { 'mcp-session-id': binding },
        query: {},
        body: { _meta: { context: { ...context, project: { path: open } } } },
      } as unknown as Request,
      response as unknown as Response,
      () => {},
    );
    expect(status).toBe(409);
    expect(invoked).toBe(false);
  });
  it('retains pending discovery creation until backend publication and cleanup settle', async () => {
    const f = await fixture();
    const owner = createProjectOwnerCredential(f.capability);
    const context: ContextData = {
      project: { path: f.directory },
      user: {},
      environment: {},
      owner,
      sessionId: 'pending',
    };
    const launcher = path.join(f.directory, 'pending.mjs');
    const marker = path.join(f.directory, 'started');
    const proceed = path.join(f.directory, 'proceed');
    fs.writeFileSync(
      launcher,
      `import fs from 'node:fs'; import { setTimeout } from 'node:timers/promises'; fs.writeFileSync(${JSON.stringify(marker)}, '1'); while (!fs.existsSync(${JSON.stringify(proceed)})) await setTimeout(10); await import(${JSON.stringify(path.resolve('test/e2e/fixtures/echo-server.js'))});`,
    );
    const creating = f.manager.createTemplateBasedServers(
      'pending',
      context,
      {},
      {
        mcpTemplates: {
          echo: {
            type: 'stdio',
            command: process.execPath,
            args: [launcher],
            protocolVersion: 'legacy',
            template: { perClient: true },
          },
        },
      },
      new Map(),
      {},
      'ephemeral',
    );
    try {
      for (let attempt = 0; !fs.existsSync(marker) && attempt < 100; attempt++) await delay(10);
      expect(fs.existsSync(marker)).toBe(true);
      await f.invoke('drain', createProjectOwnerCredential(f.capability, undefined, 'operator'));
      expect((await f.invoke('release', owner)).output).toMatchObject({
        results: [
          { complete: false, blockers: expect.arrayContaining([expect.objectContaining({ kind: 'active-work' })]) },
        ],
      });
    } finally {
      fs.writeFileSync(proceed, '1');
      await creating;
    }
    expect((await f.invoke('release', owner)).output).toMatchObject({ results: [{ complete: true }] });
  });
  it('serializes project release behind an existing close whose SDK process handle has already cleared', async () => {
    const f = await fixture();
    const pool = new ClientInstancePool();
    cleanups.push(() => pool.shutdown());
    const launcher = path.join(f.directory, 'close-race.mjs');
    fs.writeFileSync(
      launcher,
      `await import(${JSON.stringify(path.resolve('test/e2e/fixtures/echo-server.js'))}); process.removeAllListeners('SIGTERM'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`,
    );
    const instance = await pool.getOrCreateClientInstance(
      'race',
      {
        type: 'stdio',
        command: process.execPath,
        args: [launcher],
        protocolVersion: 'legacy',
        template: { perClient: true },
      },
      { project: { path: f.directory }, user: {}, environment: {} },
      'owner',
    );
    const pid = instance.transport.pid!;
    pool.removeClientFromInstance(instance.instanceKey, 'owner');
    const removing = pool.removeInstance(instance.instanceKey);
    for (let attempt = 0; instance.transport.pid && attempt < 100; attempt++) await delay(5);
    expect(instance.transport.pid).toBeNull();
    let settled = false;
    const releasing = pool.releaseInstance(instance.instanceKey).finally(() => {
      settled = true;
    });
    await delay(30);
    expect(settled).toBe(false);
    expect(() => process.kill(pid, 0)).not.toThrow();
    await Promise.all([removing, releasing]);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(pool.getAllInstances()).toEqual([]);
  });
  it.each([false, true])(
    'verifies graceful owned process exit and retains refused shutdown as a blocker (stubborn=%s)',
    async (stubborn) => {
      const f = await fixture();
      const owner = createProjectOwnerCredential(f.capability);
      const context: ContextData = {
        project: { path: f.directory },
        user: {},
        environment: {},
        owner,
        sessionId: 'process-owner',
      };
      const launcher = path.join(f.directory, 'backend.mjs');
      const pidFile = path.join(f.directory, 'backend.pid');
      const backend = path.resolve('test/e2e/fixtures/echo-server.js');
      fs.writeFileSync(
        launcher,
        `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await import(${JSON.stringify(backend)}); ${stubborn ? "process.removeAllListeners('SIGTERM'); process.on('SIGTERM', () => {});" : ''}`,
      );
      await f.manager.createTemplateBasedServers(
        'process-owner',
        context,
        {},
        {
          mcpTemplates: {
            echo: {
              type: 'stdio',
              command: process.execPath,
              args: [launcher],
              cwd: f.directory,
              protocolVersion: 'legacy',
              template: { perClient: true, shareable: false },
            },
          },
        },
        new Map(),
        {},
        'ephemeral',
      );
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      try {
        const released = await f.invoke('release', owner);
        if (stubborn) {
          expect(released.output).toMatchObject({
            results: [
              {
                complete: false,
                blockers: expect.arrayContaining([expect.objectContaining({ kind: 'backend-process' })]),
              },
            ],
          });
          expect(() => process.kill(pid, 0)).not.toThrow();
        } else {
          expect(released.output).toMatchObject({ results: [{ complete: true }] });
          expect(() => process.kill(pid, 0)).toThrow();
        }
      } finally {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
    },
  );
  it('waits after the HTTP request body is consumed and leaves timeout admission closed', async () => {
    const f = await fixture();
    const context: ContextData = { project: { path: f.directory }, user: {}, environment: {} };
    let finish!: () => void;
    const work = withProjectAdmission(
      context,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const operator = createProjectOwnerCredential(f.capability, undefined, 'operator');
    const timeout = await f.invoke('drain', operator, f.directory, 20);
    expect(timeout.output).toMatchObject({ results: [{ admission: 'draining', complete: false }] });
    const waiting = f.invoke('drain', operator, f.directory, 500);
    setTimeout(finish, 30);
    expect((await waiting).output).toMatchObject({ results: [{ admission: 'draining', complete: true }] });
    await work;
  });
  it.each(['active work', 'preparation recovery'])(
    'preserves a native-set binding while its second selected checkout has %s',
    async (blocker) => {
      const f = await fixture();
      const second = path.join(f.directory, 'second');
      fs.mkdirSync(second);
      const owner = createProjectOwnerCredential(f.capability);
      const projectSet = {
        projects: [
          { label: 'a', path: f.directory },
          { label: 'b', path: second },
        ],
        selection: ['a', 'b'],
      };
      const binding = await f.manager.registerBindingContext('shared', {
        project: {},
        user: {},
        environment: {},
        owner,
        sessionId: 'native-set',
        projectSet,
      });
      const finish = blocker === 'active work' ? getProjectLifecycle()!.begin([second]) : () => {};
      const recoveryFile = path.join(f.directory, 'backend-preparation.json');
      if (blocker === 'preparation recovery')
        fs.writeFileSync(
          recoveryFile,
          JSON.stringify([
            {
              key: 'a'.repeat(64),
              target: {
                checkoutRoot: fs.realpathSync(second),
                backendName: 'backend',
                backendIdentity: 'backend',
                configurationKey: 'config',
              },
              operation: 'query',
              policy: { allowedActions: ['initialize'] },
              action: 'initialize',
              state: 'running',
              previousJobId: 'recovery-job',
            },
          ]),
          { mode: 0o600 },
        );
      try {
        await f.invoke('release', owner, f.directory, undefined, projectSet);
        expect(f.manager.getBindingContext(binding)).toBeDefined();
      } finally {
        finish();
        if (fs.existsSync(recoveryFile)) fs.unlinkSync(recoveryFile);
      }
      await f.invoke('release', owner, f.directory, undefined, projectSet);
      expect(f.manager.getBindingContext(binding)).toBeUndefined();
    },
  );

  it('preserves a binding shared with an unselected checkout', async () => {
    const f = await fixture();
    const second = path.join(f.directory, 'second');
    fs.mkdirSync(second);
    const owner = createProjectOwnerCredential(f.capability);
    const context: ContextData = {
      project: {},
      user: {},
      environment: {},
      owner,
      sessionId: 'native-set',
      projectSet: {
        projects: [
          { label: 'a', path: f.directory },
          { label: 'b', path: second },
        ],
        selection: ['a', 'b'],
      },
    };
    const binding = await f.manager.registerBindingContext('shared', context);
    await f.invoke('release', owner);
    expect(f.manager.getBindingContext(binding)).toBeDefined();
    expect((await f.invoke('status', owner)).output).toMatchObject({
      results: [
        { complete: false, blockers: expect.arrayContaining([{ kind: 'shared-binding', id: binding, count: 2 }]) },
      ],
    });
  });
  it('releases only verified owner bindings while preserving the sibling and admitted work', async () => {
    const f = await fixture();
    const ownerA = createProjectOwnerCredential(f.capability);
    const ownerB = createProjectOwnerCredential(f.capability);
    const contextA: ContextData = {
      project: { path: f.directory },
      user: {},
      environment: {},
      sessionId: 'session-a',
      owner: ownerA,
    };
    const contextB: ContextData = { ...contextA, sessionId: 'session-b', owner: ownerB };
    const bindingA = await f.manager.registerBindingContext('a', contextA);
    const bindingB = await f.manager.registerBindingContext('b', contextB);
    let finish!: () => void;
    const work = withProjectAdmission(
      contextA,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const operator = createProjectOwnerCredential(f.capability, undefined, 'operator');
    expect((await f.invoke('drain', operator)).output).toMatchObject({ results: [{ complete: false }] });
    await expect(f.manager.registerBindingContext('late', contextB)).rejects.toThrow('draining');
    await f.invoke('release', ownerA);
    expect(f.manager.getBindingContext(bindingA)).toBeDefined();
    finish();
    await work;
    await f.invoke('release', ownerA);
    expect(f.manager.getBindingContext(bindingA)).toBeUndefined();
    expect(f.manager.getBindingContext(bindingB)).toBeDefined();
    expect((await f.invoke('status', ownerB)).output).toMatchObject({
      results: [{ complete: false, blockers: [{ kind: 'owner', id: ownerB.ownerId }] }],
    });
    await f.invoke('release', ownerB);
    expect((await f.invoke('status', ownerB)).output).toMatchObject({
      results: [{ admission: 'draining', complete: true }],
    });
  });
  it('rejects ordinary owners and forged operator roles without closing admission', async () => {
    const f = await fixture();
    const owner = createProjectOwnerCredential(f.capability);
    expect((await f.invoke('drain', owner)).status).toBe(403);
    expect((await f.invoke('drain', { ...owner, role: 'operator' })).status).toBe(403);
    expect((await f.invoke('status', owner)).output).toMatchObject({ results: [{ admission: 'open' }] });
    const operator = createProjectOwnerCredential(f.capability, undefined, 'operator');
    expect((await f.invoke('drain', operator)).output).toMatchObject({
      results: [{ admission: 'draining', complete: true }],
    });
    expect((await f.invoke('resume', operator)).output).toMatchObject({
      results: [{ admission: 'open', complete: true }],
    });
  });
});
