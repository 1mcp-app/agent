import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectLifecycle } from './projectLifecycle.js';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
describe('Checkout lifecycle admission', () => {
  it('persists drain and resume with Windows writable-file flush semantics', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-windows-'));
    directories.push(dir);
    const open = fs.openSync.bind(fs);
    const sync = fs.fsyncSync.bind(fs);
    const writable = new Set<number>();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
      const fd = open(file, flags, mode);
      if (flags === 'wx') writable.add(fd);
      else writable.delete(fd);
      return fd;
    });
    vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
      if (!writable.has(fd) || fs.fstatSync(fd).isDirectory())
        throw new Error('Windows requires a writable file handle');
      sync(fd);
    });
    const lifecycle = new ProjectLifecycle(dir);
    lifecycle.drain(dir);
    const restarted = new ProjectLifecycle(dir);
    expect(() => restarted.assertAdmission([dir])).toThrow('draining');
    restarted.resume(dir);
    expect(new ProjectLifecycle(dir).status(dir)).toMatchObject({ admission: 'open', complete: true });
  });

  it.each(['drain', 'resume'] as const)('keeps admission closed when %s cannot flush its new state', (action) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-flush-failure-'));
    directories.push(dir);
    const lifecycle = new ProjectLifecycle(dir);
    if (action === 'resume') lifecycle.drain(dir);
    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('Flush failed');
    });
    expect(() => lifecycle[action](dir)).toThrow('Flush failed');
    expect(() => lifecycle.assertAdmission([dir])).toThrow('draining');
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    if (action === 'resume') expect(new ProjectLifecycle(dir).status(dir).admission).toBe('draining');
  });

  it.each(['drain', 'resume'] as const)(
    'reports failed persistence until an explicit successful %s reconciles it',
    (reconcile) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-persistence-status-'));
      directories.push(dir);
      const lifecycle = new ProjectLifecycle(dir);
      vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
        throw new Error('Flush failed');
      });
      expect(() => lifecycle.drain(dir)).toThrow('Flush failed');
      expect(() => lifecycle.assertAdmission([dir])).toThrow('draining');
      expect(lifecycle.status(dir)).toMatchObject({
        admission: 'draining',
        complete: false,
        blockers: [{ kind: 'persistence-failed', id: fs.realpathSync(dir) }],
      });
      expect(fs.existsSync(path.join(dir, 'project-drain.json'))).toBe(false);
      lifecycle[reconcile](dir);
      expect(lifecycle.status(dir)).toMatchObject({
        admission: reconcile === 'drain' ? 'draining' : 'open',
        complete: true,
        blockers: [],
      });
      expect(new ProjectLifecycle(dir).status(dir).admission).toBe(reconcile === 'drain' ? 'draining' : 'open');
    },
  );

  it('allows admitted work to finish but never inherits admission for a new preparation job', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-nested-'));
    directories.push(dir);
    const lifecycle = new ProjectLifecycle(dir);
    await lifecycle.run([dir], async () => {
      lifecycle.drain(dir);
      lifecycle.assertAdmission([dir]);
      expect(() => lifecycle.assertScheduling([dir])).toThrow('draining');
    });
    expect(lifecycle.status(dir).complete).toBe(true);
  });
  it('reports subscriptions as blockers until their teardown confirms completion', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-watch-'));
    directories.push(dir);
    const lifecycle = new ProjectLifecycle(dir);
    const close = lifecycle.block([dir], 'subscription', 'watch-a');
    lifecycle.drain(dir);
    expect(lifecycle.status(dir)).toMatchObject({
      complete: false,
      blockers: [{ kind: 'subscription', id: 'watch-a' }],
    });
    close();
    expect(lifecycle.status(dir).complete).toBe(true);
  });
  it('keeps admission closed across timeout, runtime restart and checkout recreation until explicit resume', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-drain-'));
    directories.push(dir);
    const checkout = path.join(dir, 'checkout');
    fs.mkdirSync(checkout);
    const lifecycle = new ProjectLifecycle(dir);
    const finish = lifecycle.begin([checkout]);
    lifecycle.drain(checkout);
    expect(lifecycle.status(checkout).complete).toBe(false);
    expect(() => lifecycle.begin([checkout])).toThrow('draining');
    finish();
    expect(lifecycle.status(checkout).complete).toBe(true);
    fs.rmdirSync(checkout);
    fs.mkdirSync(checkout);
    const restarted = new ProjectLifecycle(dir);
    expect(() => restarted.begin([checkout])).toThrow('draining');
    restarted.resume(checkout);
    const done = restarted.begin([checkout]);
    done();
    expect(restarted.status(checkout)).toMatchObject({ admission: 'open', complete: true });
  });
});
