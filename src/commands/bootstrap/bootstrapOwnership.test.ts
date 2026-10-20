import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { recordProjectOwnerTarget } from '@src/commands/shared/projectOwnerStore.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapOwner, releaseSessionOwner } from './bootstrapOwnership.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe('bootstrap ownership lifecycle', () => {
  it('releases only the main-session credential and its recorded checkouts on SessionEnd', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-owner-'));
    directories.push(storage);
    const options = { client: 'codex' as const, event: 'SessionStart' as const, 'config-dir': storage };
    const parent = await bootstrapOwner(options, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'a' }));
    const worker = await bootstrapOwner(
      { ...options, event: 'SubagentStart' },
      JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 'a', agent_id: 'child' }),
    );
    expect(parent).not.toBe(worker);
    await recordProjectOwnerTarget(parent, {
      project: ['/parent'],
      'config-dir': '/runtime',
      runtimeScopeId: 'scope-a',
    });
    await recordProjectOwnerTarget(worker, {
      project: ['/worker'],
      'config-dir': '/runtime',
      runtimeScopeId: 'scope-a',
    });
    const release = vi.fn().mockResolvedValue(undefined);
    await releaseSessionOwner(
      { ...options, event: 'SessionEnd' },
      JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'a' }),
      release,
    );
    expect(release).toHaveBeenCalledExactlyOnceWith(parent, {
      project: ['/parent'],
      'config-dir': '/runtime',
      runtimeScopeId: 'scope-a',
    });
  });

  it('rejects turn completion, missing session identity and missing worker identity', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-owner-'));
    directories.push(storage);
    const options = { client: 'claude' as const, event: 'SubagentStart' as const, 'config-dir': storage };
    await expect(
      bootstrapOwner(options, JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 'parent' })),
    ).rejects.toThrow();
    const release = vi.fn();
    for (const event of ['Stop', 'SubagentStop', 'SessionStart']) {
      await expect(
        releaseSessionOwner(
          { ...options, event: 'SessionEnd' },
          JSON.stringify({ hook_event_name: event, session_id: 'parent' }),
          release,
        ),
      ).rejects.toThrow();
    }
    await expect(
      releaseSessionOwner(
        { ...options, event: 'SessionEnd' },
        JSON.stringify({ hook_event_name: 'SessionEnd' }),
        release,
      ),
    ).rejects.toThrow();
    expect(release).not.toHaveBeenCalled();
  });
});
