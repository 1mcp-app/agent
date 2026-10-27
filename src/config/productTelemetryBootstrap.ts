import type { GlobalOptions } from '@src/globalOptions.js';

let testSuppressed: boolean | undefined;

/** Process-local and monotonic: later config/bootstrap cannot admit a suppressed producer. */
export function configureProductTelemetryBootstrap(options: GlobalOptions): void {
  if (testSuppressed) return;
  testSuppressed = options['product-telemetry-test-suppressed'] === true;
}

export function getProductTelemetryBootstrap(): Readonly<{ testSuppressed: boolean }> {
  return Object.freeze({ testSuppressed: testSuppressed ?? true });
}

/** Check before opening installation state, registering hooks/timers, or constructing delivery. */
export function initializeProductTelemetry<T>(initialize: () => T): T | undefined {
  if (testSuppressed !== false) return undefined;
  return initialize();
}
