import type { GlobalOptions } from '@src/globalOptions.js';
import { collectionEnabled, type CollectionPolicy, parseEnvironmentBoolean } from '@src/productTelemetry/policy.js';

import { getRuntimeParentEnvironment } from './runtimeBootstrap.js';

let testSuppressed: boolean | undefined;
let policy: CollectionPolicy = { testSuppressed: true, ci: false };

/** Process-local and monotonic: later config/bootstrap cannot admit a suppressed producer. */
export function configureProductTelemetryBootstrap(options: GlobalOptions): void {
  testSuppressed = testSuppressed === true || options['product-telemetry-test-suppressed'] === true;
  const environment = getRuntimeParentEnvironment();
  policy = {
    testSuppressed,
    ci: parseEnvironmentBoolean(environment.CI),
    doNotTrack: parseEnvironmentBoolean(environment.DO_NOT_TRACK),
    processEnabled: options['product-telemetry'],
    ciEnabled: options['product-telemetry-ci'],
  };
}

export function getProductTelemetryBootstrap(): Readonly<{ testSuppressed: boolean }> {
  return Object.freeze({ testSuppressed: testSuppressed ?? true });
}

/** Check before opening installation state, registering hooks/timers, or constructing delivery. */
export function initializeProductTelemetry<T>(initialize: () => T): T | undefined {
  if (testSuppressed !== false) return undefined;
  return initialize();
}

export function getProductCollectionPolicy(): Readonly<CollectionPolicy> {
  return Object.freeze({ ...policy });
}

export function productCollectionEnabled(): boolean {
  return collectionEnabled(policy);
}
