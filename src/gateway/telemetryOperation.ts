import { AsyncLocalStorage } from 'node:async_hooks';

import { type OperationOutcome, startTelemetryOperation } from '@src/observability/telemetry.js';

import { telemetryFailureFacts, telemetryResultOutcome } from './telemetryOutcome.js';

const eraContext = new AsyncLocalStorage<{ inboundEra?: 'legacy' | 'modern'; outboundEra?: 'legacy' | 'modern' }>();
const serverOutcome = new AsyncLocalStorage<{ outcome?: OperationOutcome }>();

/** Preserve a locally known classification across compatibility error projection. */
export function markProtocolTelemetryOutcome(outcome: OperationOutcome): void {
  const owner = serverOutcome.getStore();
  if (owner) owner.outcome = outcome;
}

export function runWithProtocolTelemetryOutcome<T>(execute: (owner: { outcome?: OperationOutcome }) => T): T {
  const owner: { outcome?: OperationOutcome } = {};
  return serverOutcome.run(owner, () => execute(owner));
}

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
  if (options.kind === 'server') {
    return runWithProtocolTelemetryOutcome((owner) =>
      executeProtocolTelemetry(options, execute, signal, responseComplete, owner),
    );
  }
  return executeProtocolTelemetry(options, execute, signal, responseComplete);
}

async function executeProtocolTelemetry<T>(
  options: Parameters<typeof startTelemetryOperation>[0],
  execute: () => Promise<T>,
  signal?: AbortSignal,
  responseComplete?: Promise<void>,
  owner?: { outcome?: OperationOutcome },
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
    finish(owner?.outcome ?? telemetryResultOutcome(result));
    return result;
  } catch (error) {
    finish(signal?.aborted ? 'cancelled' : (owner?.outcome ?? telemetryFailureFacts(error)));
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
