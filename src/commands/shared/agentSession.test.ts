import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { bootstrapOwner, releaseSessionOwner } from '@src/commands/bootstrap/bootstrapOwnership.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAgentSessionOptions } from './agentSession.js';
import { temporaryProjectOwnerStorage } from './projectOwnerStorage.js';
import { createHookProjectOwner, hookProjectOwnerPath, recordProjectOwnerAssignment } from './projectOwnerStore.js';

let config: string;
beforeEach(async () => {
  config = await mkdtemp(path.join(os.tmpdir(), 'agent-session-test-'));
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await chmod(config, 0o700);
  await rm(config, { recursive: true, force: true });
  await rm(temporaryProjectOwnerStorage(config), { recursive: true, force: true });
});

describe('agent session coverage and storage', () => {
  it.each([
    ['', 'thread'],
    ['root', 'root'],
    ['root', 'worker'],
    ['root', ''],
  ])('falls back only when hook records are absent (%s, %s)', async (session, thread) => {
    vi.stubEnv('CODEX_SESSION_ID', session);
    vi.stubEnv('CODEX_THREAD_ID', thread);
    const options = { 'config-dir': config };
    expect(await resolveAgentSessionOptions(options)).toBe(options);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Ownership coverage gap'));
    expect(await readdir(config)).toEqual([]);
  });

  it('keeps bootstrap, automatic calls, and terminal cleanup writable with read-only runtime config', async () => {
    await chmod(config, 0o500);
    const options = {
      client: 'codex' as const,
      event: 'SessionStart' as const,
      'config-dir': config,
      project: [config],
    };
    const owner = await bootstrapOwner(
      options,
      JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'root' }),
    );
    expect(owner.startsWith(temporaryProjectOwnerStorage(config) + path.sep)).toBe(true);
    if (process.platform !== 'win32') {
      expect((await lstat(path.dirname(owner))).mode & 0o777).toBe(0o700);
      expect((await lstat(owner)).mode & 0o777).toBe(0o600);
    }
    expect(await readdir(config)).toEqual([]);
    vi.stubEnv('CODEX_SESSION_ID', '');
    vi.stubEnv('CODEX_THREAD_ID', 'root');
    expect(await resolveAgentSessionOptions({ 'config-dir': config })).toMatchObject({
      'project-owner': owner,
      project: [config],
    });
    await releaseSessionOwner(
      { ...options, event: 'SessionEnd' },
      JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'root' }),
      async () => {},
    );
    await expect(lstat(owner)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not fall back for an unknown worker of an integrated legacy root', async () => {
    await createHookProjectOwner(config, { client: 'codex', sessionId: 'root' });
    vi.stubEnv('CODEX_SESSION_ID', 'root');
    vi.stubEnv('CODEX_THREAD_ID', 'worker');
    await expect(resolveAgentSessionOptions({ 'config-dir': config })).rejects.toThrow('credential unavailable');
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it('retains incomplete legacy recovery state instead of silently creating a temporary owner', async () => {
    const owner = hookProjectOwnerPath(config, { client: 'codex', sessionId: 'root' });
    await mkdir(`${owner}.targets`, { recursive: true, mode: 0o700 });
    vi.stubEnv('CODEX_SESSION_ID', 'root');
    vi.stubEnv('CODEX_THREAD_ID', 'root');
    await expect(resolveAgentSessionOptions({ 'config-dir': config })).rejects.toThrow('credential unavailable');
  });

  it('keeps existing legacy credentials in place and makes repeated terminal cleanup idempotent', async () => {
    const owner = await createHookProjectOwner(config, { client: 'codex', sessionId: 'root' });
    await recordProjectOwnerAssignment(owner, { version: 1, worker: false, project: [config] });
    vi.stubEnv('CODEX_SESSION_ID', 'root');
    vi.stubEnv('CODEX_THREAD_ID', 'root');
    expect(await resolveAgentSessionOptions({ 'config-dir': config })).toMatchObject({ 'project-owner': owner });
    const end = { client: 'codex' as const, event: 'SessionEnd' as const, 'config-dir': config };
    const input = JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'root' });
    await releaseSessionOwner(end, input, async () => {});
    await releaseSessionOwner(end, input, async () => {});
    await expect(lstat(temporaryProjectOwnerStorage(config))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a redirected temporary storage root', async () => {
    await symlink(config, temporaryProjectOwnerStorage(config));
    vi.stubEnv('CODEX_SESSION_ID', 'root');
    vi.stubEnv('CODEX_THREAD_ID', 'root');
    await expect(resolveAgentSessionOptions({ 'config-dir': config })).rejects.toThrow('private owner-only directory');
  });

  it('does not treat a surviving root locator as absent integration for an unknown worker', async () => {
    const options = { client: 'codex' as const, event: 'SessionStart' as const, 'config-dir': config };
    const owner = await bootstrapOwner(
      options,
      JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'root' }),
    );
    await unlink(owner);
    vi.stubEnv('CODEX_SESSION_ID', 'root');
    vi.stubEnv('CODEX_THREAD_ID', 'unknown-worker');
    await expect(resolveAgentSessionOptions({ 'config-dir': config })).rejects.toThrow('credential unavailable');
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it('rejects conflicting legacy and temporary identities', async () => {
    const options = {
      client: 'codex' as const,
      event: 'SessionStart' as const,
      'config-dir': config,
      project: [config],
    };
    await bootstrapOwner(options, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'root' }));
    await createHookProjectOwner(config, { client: 'codex', sessionId: 'root' });
    vi.stubEnv('CODEX_SESSION_ID', 'root');
    vi.stubEnv('CODEX_THREAD_ID', 'root');
    await expect(resolveAgentSessionOptions({ 'config-dir': config })).rejects.toThrow('Conflicting');
  });
});
