import { AsyncLocalStorage } from 'node:async_hooks';

import { startTelemetryOperation } from '@src/observability/telemetry.js';

import { telemetryFailureFacts, telemetryResultOutcome } from './telemetryOutcome.js';

const eraContext = new AsyncLocalStorage<{ inboundEra?: 'legacy' | 'modern'; outboundEra?: 'legacy' | 'modern' }>();

export function runWithTelemetryEras<T>(
  eras: { inboundEra?: 'legacy' | 'modern'; outboundEra?: 'legacy' | 'modern' },
  execute: () => T,
): T {
  return eraContext.run({ ...eraContext.getStore(), ...eras }, execute);
}

/** Own one protocol operation through its response, including successful JS error returns. */
export async function withProtocolTelemetry<T>(
  options: Parameters<typeof startTelemetryOperation>[0],
  execute: () => Promise<T>,
  signal?: AbortSignal,
  responseComplete?: Promise<void>,
): Promise<T> {
  const eras = {
    ...eraContext.getStore(),
    ...(options.inboundEra ? { inboundEra: options.inboundEra } : {}),
    ...(options.outboundEra ? { outboundEra: options.outboundEra } : {}),
  };
  const operation = startTelemetryOperation({ ...eras, ...options });
  const finish = (outcome: Parameters<typeof operation.end>[0]) => {
    if (responseComplete) void responseComplete.then(() => operation.end(signal?.aborted ? 'cancelled' : outcome));
    else operation.end(outcome);
  };
  const cancel = () => operation.end('cancelled');
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await eraContext.run(eras, () => operation.run(execute, signal));
    finish(telemetryResultOutcome(result));
    return result;
  } catch (error) {
    finish(signal?.aborted ? 'cancelled' : telemetryFailureFacts(error));
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
