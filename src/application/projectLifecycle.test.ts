import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectLifecycle } from './projectLifecycle.js';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
describe('Checkout lifecycle admission', () => {
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
