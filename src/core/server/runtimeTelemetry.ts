import { parseTelemetryConfig } from '@src/config/telemetryConfig.js';
import { selectTelemetryEnvironment } from '@src/config/telemetryEnvironment.js';
import { MCP_SERVER_VERSION } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import {
  getTelemetryStatus,
  markTelemetryStopping,
  startTelemetry,
  stopTelemetry,
} from '@src/observability/telemetry.js';

import { startRuntimeControl } from './runtimeControl.js';

let telemetryCompletionStarted = false;
let statusControl: Awaited<ReturnType<typeof startRuntimeControl>> | undefined;

export async function startForegroundTelemetryStatus(scope: string, claimId: string): Promise<void> {
  statusControl = await startRuntimeControl(scope, claimId, () => getTelemetryStatus(), { statusOnly: true });
}

/** Runtime-only entry point. Supervisors and one-shot commands never call this. */
export async function startRuntimeTelemetry(role: 'runtime' | 'proxy'): Promise<void> {
  telemetryCompletionStarted = false;
  try {
    const config = parseTelemetryConfig(selectTelemetryEnvironment());
    await startTelemetry(config, {
      role,
      serviceVersion: MCP_SERVER_VERSION,
      onDiagnostic: (diagnostic) =>
        logger.warn('telemetry.diagnostic', {
          diagnosticEvent: diagnostic.event,
          signal: diagnostic.signal,
          category: diagnostic.category,
          suppressed: diagnostic.suppressed,
        }),
    });
  } catch {
    // Provider/TLS failures can contain endpoint URLs, keys or exporter headers.
    throw new Error('Telemetry initialization failed; check supported telemetry configuration');
  }
}

export function beginRuntimeTelemetryShutdown(): void {
  try {
    markTelemetryStopping();
  } catch {
    /* Status projection never owns shutdown. */
  }
}

let fatalExitRequested = false;

/** Fatal completion takes precedence over an already pending graceful exit. */
export function exitRuntime(code: number): never {
  return process.exit(fatalExitRequested ? 1 : code);
}

let ownerDeadlineMs: number | undefined;
export function setRuntimeTelemetryShutdownDeadline(deadlineMs: number): void {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) return;
  ownerDeadlineMs = Math.min(ownerDeadlineMs ?? Infinity, deadlineMs);
  if (telemetryCompletionStarted) {
    void stopTelemetry({ deadlineMs: ownerDeadlineMs, fatal: fatalExitRequested }).catch(() => undefined);
  }
}

/** Called only after the existing owner has drained/terminated gateway work. */
export async function finishRuntimeTelemetry(fatal = false): Promise<void> {
  telemetryCompletionStarted = true;
  if (fatal) fatalExitRequested = true;
  beginRuntimeTelemetryShutdown();
  const deadlineMs = Math.min(ownerDeadlineMs ?? Infinity, Date.now() + (fatal ? 1000 : 5000));
  try {
    await stopTelemetry({ deadlineMs, fatal });
  } catch {
    /* Telemetry cleanup cannot change the runtime's original exit result. */
  }
  const control = statusControl;
  statusControl = undefined;
  try {
    await control?.close();
  } catch {
    /* Read-only status cleanup cannot change the runtime's exit result. */
  }
}

/** Fatal exits retain exit 1 and do not run the ordinary gateway drain. */
export function installTelemetryCompletionHandlers(): void {
  let fatal: Promise<void> | undefined;
  const fail = () => {
    fatal ??= finishRuntimeTelemetry(true).then(() => {
      exitRuntime(1);
    });
  };
  process.once('uncaughtException', fail);
  process.once('unhandledRejection', fail);
  process.once('beforeExit', () => {
    void finishRuntimeTelemetry();
  });
}
