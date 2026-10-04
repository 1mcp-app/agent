import fs from 'node:fs';

import type { BackgroundSupervisorEvent } from '@src/core/server/backgroundRuntimeSupervisor.js';
import { normalizeEvent } from '@src/observability/events/normalize.js';
import { ownData } from '@src/observability/privacy/fields.js';

/** Supervisor startup precedes worker logging configuration; retain the same typed local boundary. */
export function appendSupervisorEvent(logFile: string, event: BackgroundSupervisorEvent): void {
  const kind = ownData(event, 'event');
  if (typeof kind !== 'string') return;
  const exit = ownData(event, 'exit');
  const normalized = normalizeEvent(`supervisor.${kind}`, {
    supervisorPid: ownData(event, 'supervisorPid'),
    runtimePid: ownData(event, 'runtimePid'),
    restartAttempt: ownData(event, 'restartAttempt'),
    delayMs: ownData(event, 'delayMs'),
    exitCode: ownData(exit, 'code'),
    error: ownData(exit, 'error'),
  });
  if (normalized) fs.appendFileSync(logFile, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
}
