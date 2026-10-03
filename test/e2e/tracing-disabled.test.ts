import { execFileSync } from 'node:child_process';

import { expect, it } from 'vitest';

it('preserves propagation without provider/exporter activation in fresh disabled and default processes', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-propagation-disabled.mjs'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(output.trim().split('\n')).toEqual([
    'OTEL_SDK_DISABLED=unset: propagation active; no provider, baggage or network connection',
    'OTEL_SDK_DISABLED=true: propagation active; no provider, baggage or network connection',
  ]);
});
