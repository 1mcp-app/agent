import { getTelemetryStatus, type OperationOutcome, startTelemetryOperation } from '@src/observability/telemetry.js';

/** Reviewed HTTP client seam. Request/response data is only forwarded, never supplied to signals. */
export async function fetchWithTelemetry(
  delegate: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const state = getTelemetryStatus().state;
  if (state === 'disabled' || state === 'stopped') return delegate(input, init);
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const operation = startTelemetryOperation({ kind: 'http', httpDirection: 'outbound', phase: 'http-request' });
  let ended = false;
  const finish = (outcome: OperationOutcome) => {
    if (ended) return;
    ended = true;
    signal?.removeEventListener('abort', abort);
    operation.end(outcome);
  };
  const abort = () => finish('cancelled');
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await operation.run(() => delegate(input, init), signal ?? undefined);
    const outcome = response.ok ? 'success' : 'transport-error';
    if (!response.body) {
      finish(outcome);
      return response;
    }
    const reader = response.body.getReader();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            finish(cancelled || signal?.aborted ? 'cancelled' : outcome);
            reader.releaseLock();
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          finish(signal?.aborted ? 'cancelled' : 'transport-error');
          reader.releaseLock();
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancelled = true;
        try {
          await reader.cancel(reason);
        } finally {
          finish('cancelled');
          reader.releaseLock();
        }
      },
    });
    const observed = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    for (const property of ['url', 'redirected', 'type'] as const) {
      Object.defineProperty(observed, property, { value: response[property] });
    }
    return observed;
  } catch (error) {
    finish(signal?.aborted ? 'cancelled' : 'transport-error');
    throw error;
  }
}
