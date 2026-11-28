import { RuntimeCatalogBackendChangedError } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { ErrorCode } from '@src/sdk/contracts/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import { describe, expect, it, vi } from 'vitest';

import { withCatalogBackendRetry } from './catalogRequestRetry.js';

describe('withCatalogBackendRetry', () => {
  it('retries one backend replacement and returns the refreshed listing', async () => {
    const work = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RuntimeCatalogBackendChangedError())
      .mockResolvedValueOnce('catalog');

    await expect(withCatalogBackendRetry(work)).resolves.toBe('catalog');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('propagates a second consecutive backend replacement', async () => {
    const work = vi.fn<() => Promise<string>>().mockRejectedValue(new RuntimeCatalogBackendChangedError());

    await expect(withCatalogBackendRetry(work)).rejects.toBeInstanceOf(RuntimeCatalogBackendChangedError);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not retry a cursored page', async () => {
    const error = new RuntimeCatalogBackendChangedError();
    const work = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(withCatalogBackendRetry(work, { cursor: 'page-2' })).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('does not retry once the request is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new RuntimeCatalogBackendChangedError();
    const work = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(withCatalogBackendRetry(work, { signal: controller.signal })).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('does not retry unrelated failures', async () => {
    const error = new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams, {
      reason: 'stale_generation',
    });
    const work = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(withCatalogBackendRetry(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
