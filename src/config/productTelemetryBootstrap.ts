import type { GlobalOptions } from '@src/globalOptions.js';
import { collectionEnabled, type CollectionPolicy, parseEnvironmentBoolean } from '@src/productTelemetry/policy.js';

import { getRuntimeParentEnvironment } from './runtimeBootstrap.js';

let testSuppressed: boolean | undefined;
let policy: CollectionPolicy = { testSuppressed: true, ci: false };

/** Process-local and monotonic: later config/bootstrap cannot admit a suppressed producer. */
export function configureProductTelemetryBootstrap(options: GlobalOptions): void {
  const environment = getRuntimeParentEnvironment();
  const launcherSuppressed = parseEnvironmentBoolean(environment.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED);
  testSuppressed =
    testSuppressed === true || launcherSuppressed || options['product-telemetry-test-suppressed'] === true;
  policy = {
    testSuppressed,
    ci: parseEnvironmentBoolean(environment.CI),
    doNotTrack: parseEnvironmentBoolean(environment.DO_NOT_TRACK),
    // Hook parsers intentionally disable general environment option parsing.
    processEnabled: options['product-telemetry'] ?? optionalEnvironmentBoolean(environment.ONE_MCP_PRODUCT_TELEMETRY),
    ciEnabled: options['product-telemetry-ci'] ?? optionalEnvironmentBoolean(environment.ONE_MCP_PRODUCT_TELEMETRY_CI),
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

function optionalEnvironmentBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return parseEnvironmentBoolean(value);
}
