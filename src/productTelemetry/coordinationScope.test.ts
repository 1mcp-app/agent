import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const evidence = vi.hoisted(() => ({ boot: 'boot-a', namespace: 'pid:[1]', denied: false }));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => {
    if (evidence.denied) throw new Error('denied');
    return evidence.boot;
  }),
  readlink: vi.fn(async () => evidence.namespace),
}));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  vi.resetModules();
  evidence.boot = 'boot-a';
  evidence.namespace = 'pid:[1]';
  evidence.denied = false;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
});
afterEach(() => Object.defineProperty(process, 'platform', platform));

it('binds the scope to both boot identity and PID namespace', async () => {
  const first = await (await import('./coordinationScope.js')).coordinationScope();
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  vi.resetModules();
  evidence.namespace = 'pid:[2]';
  const otherNamespace = await (await import('./coordinationScope.js')).coordinationScope();
  expect(otherNamespace).not.toBe(first);
  vi.resetModules();
  evidence.namespace = 'pid:[1]';
  evidence.boot = 'boot-b';
  expect(await (await import('./coordinationScope.js')).coordinationScope()).not.toBe(first);
});

it('fails closed when boot evidence cannot be read', async () => {
  evidence.denied = true;
  const { coordinationScope } = await import('./coordinationScope.js');
  expect(await coordinationScope()).toBeUndefined();
  evidence.denied = false;
  expect(await coordinationScope()).toMatch(/^[0-9a-f]{64}$/);
});

it('does not share a background lookup with a foreground caller', async () => {
  const { readFile } = await import('node:fs/promises');
  const { coordinationScope } = await import('./coordinationScope.js');
  vi.mocked(readFile).mockClear();
  const background = coordinationScope(true);
  expect(coordinationScope(true)).toBe(background);
  const foreground = coordinationScope(false);
  expect(foreground).not.toBe(background);
  await Promise.all([background, foreground]);
  expect(readFile).toHaveBeenCalledTimes(2);
});

it('fails closed when PID namespace evidence is empty', async () => {
  evidence.namespace = '';
  expect(await (await import('./coordinationScope.js')).coordinationScope()).toBeUndefined();
});
