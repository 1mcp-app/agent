import logger from '@src/logger/logger.js';
import type { EventFields } from '@src/observability/events/normalize.js';
import type { EventName } from '@src/observability/events/registry.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** HTTP/JSON-RPC instrumentation shares the typed local event boundary. */
export function log<E extends EventName>(level: LogLevel, event: E, fields?: EventFields<E>): void {
  logger[level](event, fields);
}
export const logHttp = log;
export const logJsonRpc = log;
export const logError = <E extends EventName>(event: E, fields?: EventFields<E>) => log('error', event, fields);
export const logWarn = <E extends EventName>(event: E, fields?: EventFields<E>) => log('warn', event, fields);
export const logInfo = <E extends EventName>(event: E, fields?: EventFields<E>) => log('info', event, fields);
export const logDebug = <E extends EventName>(event: E, fields?: EventFields<E>) => log('debug', event, fields);
