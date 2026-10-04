import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ports, closed } = vi.hoisted(() => ({ ports: [] as number[], closed: vi.fn() }));
vi.mock('node:net', () => ({
  createServer: () => {
    const port = ports.shift();
    return {
      once: vi.fn(),
      listen: (_port: number, _host: string, ready: () => void) => ready(),
      address: () => ({ port }),
      close: (done: () => void) => {
        closed();
        done();
      },
    };
  },
}));

describe('conformance loopback allocation', () => {
  beforeEach(() => {
    vi.resetModules();
    ports.length = 0;
    closed.mockClear();
  });

  it('does not issue a released port to another concurrent gateway startup', async () => {
    ports.push(41001, 41001, 41002);
    const { reserveLoopbackPort } = await import('./loopbackPorts.js');
    await expect(Promise.all([reserveLoopbackPort(), reserveLoopbackPort()])).resolves.toEqual([41001, 41002]);
    expect(closed).toHaveBeenCalledTimes(3);
  });

  it('bounds allocation attempts and closes every rejected listener', async () => {
    ports.push(...Array.from({ length: 33 }, () => 41001));
    const { reserveLoopbackPort } = await import('./loopbackPorts.js');
    await expect(reserveLoopbackPort()).resolves.toBe(41001);
    await expect(reserveLoopbackPort()).rejects.toThrow('port-reservation-exhausted');
    expect(closed).toHaveBeenCalledTimes(33);
  });
});
