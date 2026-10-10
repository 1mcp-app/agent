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

afterEach(() => vi.restoreAllMocks());

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

describe('preparation config authority', () => {
  it('accepts backend-keyed project preferences and rejects runtime permissions in project config', () => {
    expect(validateProjectConfig({ preparation: { codegraph: { enabled: true } } })).toEqual({
      preparation: { codegraph: { enabled: true } },
    });
    expect(() =>
      validateProjectConfig({ preparation: { codegraph: { enabled: true, allowedActions: ['install'] } } }),
    ).toThrow();
  });
  it('requires an installed absolute executable and exact supported version with bounded actions', () => {
    const preparation = {
      adapter: 'codegraph',
      executable: '/installed/codegraph',
      expectedVersion: '1.6.2',
      allowedActions: ['initialize', 'sync'],
    };
    expect(transportConfigSchema.parse({ preparation }).preparation).toEqual(preparation);
    expect(transportConfigSchema.safeParse({ preparation: { ...preparation, executable: 'npx' } }).success).toBe(false);
    expect(
      transportConfigSchema.safeParse({ preparation: { ...preparation, expectedVersion: 'latest' } }).success,
    ).toBe(false);
    expect(
      transportConfigSchema.safeParse({ preparation: { ...preparation, allowedActions: ['install'] } }).success,
    ).toBe(false);
  });
  it('validates configurable runtime scheduler bounds without inventing authority defaults', () => {
    expect(applicationConfigSchema.parse({ preparation: { concurrency: 2, queueCapacity: 32 } }).preparation).toMatchObject({
      concurrency: 2,
      queueCapacity: 32,
    });
    expect(applicationConfigSchema.safeParse({ preparation: { concurrency: 0 } }).success).toBe(false);
    expect(transportConfigSchema.parse({ command: 'codegraph' }).preparation).toBeUndefined();
  });
});
