import { RuntimeCatalogBackendChangedError } from '@src/core/capabilities/runtimeCapabilityCatalog.js';

/**
 * Retries one request-path catalog listing when a captured backend is replaced while it runs.
 *
 * The retry re-invokes the whole work: every snapshot captures the connection map it was acquired
 * from, so listing the same snapshot again fails the current check every time. Only a first page is
 * eligible — a cursored page is checked against its scoped state and surfaces InvalidParams once that
 * generation is gone, so retrying one would replace a transient failure with a worse error.
 */
export async function withCatalogBackendRetry<T>(
  work: () => Promise<T>,
  options: { cursor?: string; signal?: AbortSignal } = {},
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (options.cursor !== undefined) throw error;
    if (!(error instanceof RuntimeCatalogBackendChangedError)) throw error;
    if (options.signal?.aborted) throw error;
    return work();
  }
}
