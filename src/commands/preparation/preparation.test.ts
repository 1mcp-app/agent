import { ApiClient } from '@src/commands/shared/apiClient.js';
import { attachReusableClientSurface } from '@src/commands/shared/clientSurfaceAttachment.js';
import { validateProjectConfig } from '@src/config/projectConfigTypes.js';
import { applicationConfigSchema, transportConfigSchema } from '@src/core/types/transport.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatPreparationOutput, preparationCommand } from './preparation.js';

vi.mock('@src/commands/shared/clientSurfaceAttachment.js', () => ({
  attachReusableClientSurface: vi.fn(),
  formatClientSurfaceAuthRequiredMessage: () => 'Authentication required',
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preparation CLI', () => {
  it('uses runtime REST attachment and carries proof plus context without upstream fallback', async () => {
    const post = vi
      .spyOn(ApiClient.prototype, 'post')
      .mockResolvedValue({ ok: true, status: 200, data: { state: 'ready' } });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const context = { project: { path: '/selected' }, user: {}, environment: {} };
    const proof = { version: 1, signature: 'proof' };
    vi.mocked(attachReusableClientSurface).mockImplementation(async (input) => {
      const rest = await input.rest({
        baseUrl: 'http://localhost',
        options: { tags: ['code'] },
        context,
        contextProof: proof,
        sessionId: 'session',
      } as never);
      expect(await input.mcp({} as never)).toMatchObject({ status: 'error' });
      expect(rest).toMatchObject({ status: 'success', value: { state: 'ready' } });
      return { status: 'success', value: { state: 'ready' } } as never;
    });
    await preparationCommand({ action: 'prepare', backend: 'codegraph' });
    expect(post).toHaveBeenCalledWith(
      '/api/v1/preparation?tags=code',
      expect.objectContaining({ action: 'prepare', backend: 'codegraph', _meta: { context, contextProof: proof } }),
      expect.anything(),
    );
  });

  it('validates ids and waits before attaching', async () => {
    const attach = vi.mocked(attachReusableClientSurface).mockClear();
    await expect(preparationCommand({ action: 'wait', backend: 'codegraph' })).rejects.toThrow();
    await expect(preparationCommand({ action: 'cancel', backend: 'codegraph', id: 'preparation-1' })).rejects.toThrow();
    await expect(preparationCommand({ action: 'status', backend: 'codegraph', 'wait-ms': 5 })).rejects.toThrow();
    expect(attach).not.toHaveBeenCalled();
  });

  it.each(['wait', 'prepare', 'status', 'retry'] as const)(
    'allows %s to complete at a runtime-configured budget longer than 15 seconds',
    async (action) => {
      vi.useFakeTimers();
      const runtimeWaitMs = 20_000;
      let requestSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, input: RequestInit) => {
          const request = JSON.parse(input.body as string);
          expect(request.action).toBe(action);
          expect(request.waitMs).toBeUndefined();
          requestSignal = input.signal ?? undefined;
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify({ state: 'running' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  }),
                ),
              request.waitMs ?? runtimeWaitMs,
            );
            input.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            );
          });
        }),
      );
      vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      vi.mocked(attachReusableClientSurface).mockImplementation(
        async (input) =>
          input.rest({ baseUrl: 'http://localhost', options: {}, context: {}, sessionId: 'session' } as never) as never,
      );
      let settled = false;
      const command = preparationCommand({
        action,
        backend: 'codegraph',
        ...(action === 'wait' ? { id: '00000000-0000-4000-8000-000000000001' } : {}),
      }).then(() => {
        settled = true;
      });
      // Observe rejection immediately so a former premature timeout is reported only by this assertion.
      const outcome = command.then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(15_000);
      expect(requestSignal?.aborted).toBe(false);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toEqual({ error: undefined });
      expect(settled).toBe(true);
    },
  );

  it.each([undefined, 0, 25_000, 3_600_000])('keeps wait %s within a bounded matching HTTP timeout', async (waitMs) => {
    const post = vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      ok: true,
      status: 200,
      data: { state: 'running' },
    });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.mocked(attachReusableClientSurface).mockImplementation(
      async (input) =>
        input.rest({ baseUrl: 'http://localhost', options: {}, context: {}, sessionId: 'session' } as never) as never,
    );
    await preparationCommand({
      action: 'wait',
      backend: 'codegraph',
      id: '00000000-0000-4000-8000-000000000001',
      'wait-ms': waitMs,
    });
    expect(post).toHaveBeenCalledWith('/api/v1/preparation', expect.objectContaining({ action: 'wait', waitMs }), {
      timeout: (waitMs ?? 3_600_000) + 10_000,
    });
  });

  it('retains the short cancellation timeout without supplying an invalid wait override', async () => {
    const post = vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      ok: true,
      status: 200,
      data: { state: 'cancelled' },
    });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.mocked(attachReusableClientSurface).mockImplementation(
      async (input) =>
        input.rest({ baseUrl: 'http://localhost', options: {}, context: {}, sessionId: 'session' } as never) as never,
    );
    await preparationCommand({
      action: 'cancel',
      backend: 'codegraph',
      id: '00000000-0000-4000-8000-000000000001',
    });
    expect(post).toHaveBeenCalledWith(
      '/api/v1/preparation',
      expect.objectContaining({ action: 'cancel', waitMs: undefined }),
      { timeout: 15_000 },
    );
  });

  it('formats pending/failure states truthfully', () => {
    expect(
      formatPreparationOutput(
        {
          state: 'job',
          status: {
            state: 'failed',
            id: 'id',
            target: { backendName: 'codegraph' },
            failure: { instructions: 'Retry with larger budget' },
          },
        },
        'text',
      ),
    ).toBe('codegraph: failed (id)\nRetry with larger budget');
  });
});

describe('preparation inspection output', () => {
  it('reports action elapsed time and explicit progress without inferring a percentage', () => {
    expect(
      formatPreparationOutput(
        {
          state: 'job',
          status: {
            state: 'running',
            id: 'id',
            action: 'sync',
            elapsedMs: 1250,
            target: { backendName: 'source-search' },
            progress: { completed: 2, total: 5, unit: 'files' },
          },
        },
        'text',
      ),
    ).toBe('source-search: running (id)\naction: sync; elapsed: 1250 ms\nprogress: 2/5 files');
  });
});

describe('preparation config authority', () => {
  it('accepts backend-keyed project preferences and rejects runtime permissions in project config', () => {
    expect(validateProjectConfig({ preparation: { codegraph: { enabled: true } } })).toEqual({
      preparation: { codegraph: { enabled: true } },
    });
    expect(() =>
      validateProjectConfig({ preparation: { codegraph: { enabled: true, allowedActions: ['install'] } } }),
    ).toThrow();
  });
  it('accepts generic affected tools and runtime command authority without backend version coupling', () => {
    const preparation = {
      adapter: 'configured-command',
      affectedTools: ['lookup'],
      allowedActions: ['initialize', 'sync'],
      integration: {
        probe: { executable: '/installed/readiness', args: ['{checkout}', '{operation}'] },
        readinessExitCodes: {
          '0': { state: 'ready' },
          '2': { state: 'required', action: 'initialize', instructions: 'Initialize' },
        },
        actions: { initialize: { executable: '/installed/prepare', args: ['{checkout}'] } },
        containment: 'posix-process-group',
      },
    };
    expect(transportConfigSchema.parse({ preparation }).preparation).toMatchObject(preparation);
    expect(transportConfigSchema.safeParse({ preparation: { ...preparation, affectedTools: [] } }).success).toBe(false);
    expect(
      transportConfigSchema.safeParse({ preparation: { ...preparation, expectedVersion: 'latest' } }).success,
    ).toBe(false);
    expect(
      transportConfigSchema.safeParse({ preparation: { ...preparation, allowedActions: ['install'] } }).success,
    ).toBe(true);
    expect(
      transportConfigSchema.safeParse({
        preparation: { adapter: 'configured-command', affectedTools: 'all', allowedActions: [] },
      }).success,
    ).toBe(true);
  });
  it('validates configurable runtime scheduler bounds without inventing authority defaults', () => {
    expect(
      applicationConfigSchema.parse({ preparation: { concurrency: 2, queueCapacity: 32 } }).preparation,
    ).toMatchObject({
      concurrency: 2,
      queueCapacity: 32,
    });
    expect(applicationConfigSchema.safeParse({ preparation: { concurrency: 0 } }).success).toBe(false);
    expect(transportConfigSchema.parse({ command: 'codegraph' }).preparation).toBeUndefined();
  });
});
