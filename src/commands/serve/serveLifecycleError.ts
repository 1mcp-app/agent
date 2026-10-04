import { types } from 'node:util';

import { RuntimeScopeOwnedError } from '@src/core/server/runtimeScopeOwnership.js';

/** Public CLI guidance is a closed vocabulary, independent of private exception diagnostics. */
const PUBLIC_FAILURES = {
  ownership:
    'A runtime already owns this Runtime Scope or ownership is uncertain. Use serve --status with the selected --config-dir and the original CLI or service manager for explicit recovery; no takeover was attempted.',
  activation:
    'Runtime activation failed or did not become ready. Inspect serve --status with the selected --config-dir, then retry serve --restart after resolving the cause.',
  recovery:
    'Runtime control is unreachable or retirement could not be confirmed; ownership retained. Inspect serve --status with the selected --config-dir and use the original CLI or service manager for explicit recovery. Do not delete ownership records.',
  'drain-aborted':
    'Runtime replacement aborted before the drain deadline; no stop was requested. Inspect serve --status with the selected --config-dir.',
  'drain-timeout':
    'Runtime restart aborted at the drain deadline. The old runtime was asked to resume admission. Inspect serve --status with the selected --config-dir. Allow more time with --drain-timeout, or interrupt unfinished calls using serve --restart --on-drain-timeout restart. Calls will not be replayed.',
  transport: 'Background runtime requires HTTP transport.',
  configuration: 'Runtime backend configuration is invalid; correct the selected Runtime Scope before restarting.',
} as const;
Object.freeze(PUBLIC_FAILURES);
type LifecycleFailureCode = keyof typeof PUBLIC_FAILURES;
const knownFailures = new WeakMap<object, LifecycleFailureCode>();

/** Preserve the existing thrown value and its control-flow semantics; mark only locally known phases. */
export function markServeLifecycleFailure(code: LifecycleFailureCode, error: unknown): unknown {
  const failure = typeof error === 'object' && error !== null ? error : new Error(PUBLIC_FAILURES[code]);
  knownFailures.set(failure, code);
  return failure;
}

export function describeServeLifecycleFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = knownFailures.get(error);
    if (code) return PUBLIC_FAILURES[code];
    if (!types.isProxy(error) && Object.getPrototypeOf(error) === RuntimeScopeOwnedError.prototype)
      return PUBLIC_FAILURES.ownership;
  }
  return 'Server startup failed. See the configured log for bounded failure facts.';
}
