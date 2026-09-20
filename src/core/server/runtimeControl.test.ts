import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectRuntimeControl, runtimeControlExists, startRuntimeControl } from './runtimeControl.js';

let dir: string;
let claimId: string;
const closers: Array<() => Promise<void>> = [];
function writeOwner(id = claimId): void {
  fs.mkdirSync(path.join(dir, 'runtime.owner'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(dir, 'runtime.owner', 'owner.json'),
    JSON.stringify({
      version: 1,
      pid: process.pid,
      claimId: id,
      kind: 'background-supervisor',
      claimedAt: new Date().toISOString(),
    }),
  );
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-control-'));
  claimId = randomUUID();
  writeOwner();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const close of closers.splice(0)) await close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('authenticated runtime control', () => {
  it('authenticates requests and responses without process inspection or transmitting the credential', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('inspection denied');
    });
    const handler = vi.fn((_method, payload, operationId) => ({ payload, operationId }));
    const server = await startRuntimeControl(dir, claimId, handler);
    closers.push(server.close);
    const realFetch = fetch;
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url, init) => {
        bodies.push(String(init.body));
        return realFetch(url, init);
      }),
    );
    const client = await connectRuntimeControl(dir);
    const operationId = randomUUID();
    await expect(client!.request('prepare-replacement', { digest: 'frozen' }, operationId)).resolves.toEqual({
      payload: { digest: 'frozen' },
      operationId,
    });
    expect(kill).not.toHaveBeenCalled();
    const secretFile = fs.readdirSync(dir).find((name) => name.endsWith('.secret'))!;
    expect(bodies.join('')).not.toContain(fs.readFileSync(path.join(dir, secretFile), 'utf8'));
    expect(handler).toHaveBeenCalledExactlyOnceWith('prepare-replacement', { digest: 'frozen' }, operationId);
  });

  it('preserves an existing generation credential when duplicate startup is rejected', async () => {
    const server = await startRuntimeControl(dir, claimId, () => 'ok');
    closers.push(server.close);
    await expect(startRuntimeControl(dir, claimId, () => 'duplicate')).rejects.toMatchObject({ code: 'EEXIST' });
    const client = await connectRuntimeControl(dir);
    await expect(client!.request('operation-status')).resolves.toBe('ok');
  });

  it('rejects a modified response instead of trusting unsigned results', async () => {
    const server = await startRuntimeControl(dir, claimId, () => ({ accepted: false }));
    closers.push(server.close);
    const realFetch = fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        const response = await realFetch(url, init);
        if (!String(url).endsWith('/request')) return response;
        const body = await response.json();
        return new Response(JSON.stringify({ ...body, value: { accepted: true } }));
      }),
    );
    const client = await connectRuntimeControl(dir);
    await expect(client!.request('stop')).rejects.toThrow('authentication');
  });

  it('rejects replay and payload tampering before calling the handler', async () => {
    const handler = vi.fn(() => 'ok');
    const server = await startRuntimeControl(dir, claimId, handler);
    closers.push(server.close);
    const realFetch = fetch;
    let captured = '';
    vi.stubGlobal(
      'fetch',
      vi.fn((url, init) => {
        if (String(url).endsWith('/request')) captured = String(init.body);
        return realFetch(url, init);
      }),
    );
    const client = await connectRuntimeControl(dir);
    await client!.request('stop');
    const replay = await realFetch(new URL('request', server.descriptor.url), { method: 'POST', body: captured });
    expect(replay.status).toBe(403);
    expect(handler).toHaveBeenCalledTimes(1);
    vi.stubGlobal(
      'fetch',
      vi.fn((url, init) => {
        if (String(url).endsWith('/request')) {
          const body = JSON.parse(String(init.body));
          body.method = 'stop';
          return realFetch(url, { ...init, body: JSON.stringify(body) });
        }
        return realFetch(url, init);
      }),
    );
    await expect(client!.request('describe')).rejects.toThrow('rejected');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not send privileged payload to an unauthenticated reused endpoint', async () => {
    const server = await startRuntimeControl(dir, claimId, () => 'ok');
    closers.push(server.close);
    const requests: unknown[] = [];
    const impostor = http.createServer(async (req, res) => {
      let text = '';
      for await (const chunk of req) text += chunk;
      requests.push(JSON.parse(text));
      const { nonce } = JSON.parse(text);
      res.end(JSON.stringify({ nonce, challenge: randomUUID(), expires: Date.now() + 10_000, signature: 'forged' }));
    });
    await new Promise<void>((resolve) => impostor.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => impostor.close(() => resolve())));
    const address = impostor.address() as { port: number };
    fs.writeFileSync(
      path.join(dir, 'runtime-control.json'),
      JSON.stringify({ ...server.descriptor, url: `http://127.0.0.1:${address.port}/` }),
    );
    const client = await connectRuntimeControl(dir);
    await expect(client!.request('prepare-replacement', { secretConfiguration: 'private-value' })).rejects.toThrow(
      'authentication',
    );
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests)).not.toContain('private-value');
  });

  it('rejects a superseded owner even if its listener and secret remain available', async () => {
    const handler = vi.fn();
    const server = await startRuntimeControl(dir, claimId, handler);
    closers.push(server.close);
    const client = await connectRuntimeControl(dir);
    writeOwner(randomUUID());
    await expect(client!.request('stop')).rejects.toThrow('no longer owns');
    await expect(connectRuntimeControl(dir)).rejects.toThrow('no longer owns');
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed without repairing insecure credential permissions', async () => {
    if (process.platform === 'win32') return;
    const server = await startRuntimeControl(dir, claimId, () => 'ok');
    closers.push(server.close);
    const secret = path.join(
      dir,
      fs.readdirSync(dir).find((name) => name.endsWith('.secret'))!,
    );
    fs.chmodSync(secret, 0o644);
    await expect(connectRuntimeControl(dir)).rejects.toThrow('owner-only');
    expect(fs.statSync(secret).mode & 0o777).toBe(0o644);
  });

  it('rejects expired challenges', async () => {
    const handler = vi.fn();
    const server = await startRuntimeControl(dir, claimId, handler);
    closers.push(server.close);
    const realFetch = fetch;
    const now = Date.now();
    vi.stubGlobal(
      'fetch',
      vi.fn((url, init) => {
        if (String(url).endsWith('/request')) vi.spyOn(Date, 'now').mockReturnValue(now + 20_000);
        return realFetch(url, init);
      }),
    );
    const client = await connectRuntimeControl(dir);
    await expect(client!.request('stop')).rejects.toThrow('rejected');
    expect(handler).not.toHaveBeenCalled();
  });

  it('preserves successor metadata during old listener cleanup', async () => {
    const server = await startRuntimeControl(dir, claimId, () => 'ok');
    const successor = { ...server.descriptor, claimId: randomUUID() };
    fs.writeFileSync(path.join(dir, 'runtime-control.json'), JSON.stringify(successor));
    await server.close();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runtime-control.json'), 'utf8'))).toEqual(successor);
    expect(runtimeControlExists(dir)).toBe(true);
  });
});
