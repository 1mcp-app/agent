import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createTestProcessEnvironment } from '../../scripts/test-process-environment.mjs';

// Controlled suppressed producer fixture; no collector is constructed.
describe('built Product Usage Telemetry bootstrap', () => {
  it.each([false, true])('preserves operator state with CI=%s and conflicting explicit enablement', (ci) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'product-suppression-'));
    const state = path.join(directory, 'operator-state.json');
    const contents = JSON.stringify({ preference: true, identity: 'synthetic-existing', queue: ['retained'] });
    fs.writeFileSync(state, contents);
    const optionsUrl = pathToFileURL(path.resolve('build/globalOptions.js')).href;
    const bootstrapUrl = pathToFileURL(path.resolve('build/config/productTelemetryBootstrap.js')).href;
    const script = `
      import fs from 'node:fs';
      import yargs from 'yargs';
      import { withGlobalOptions } from ${JSON.stringify(optionsUrl)};
      import { initializeProductTelemetry, getProductTelemetryBootstrap } from ${JSON.stringify(bootstrapUrl)};
      await withGlobalOptions(yargs([]).env('ONE_MCP').exitProcess(false))
        .command('probe', 'controlled fixture', () => {}, () => {
          initializeProductTelemetry(() => { fs.writeFileSync(process.env.FIXTURE_STATE, 'unexpected producer initialization'); });
          console.log(JSON.stringify(getProductTelemetryBootstrap()));
        }).parseAsync(['probe', '--product-telemetry-test-suppressed=false']);
    `;
    try {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        env: createTestProcessEnvironment({ CI: String(ci), FIXTURE_STATE: state }),
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ testSuppressed: true });
      expect(fs.readFileSync(state, 'utf8')).toBe(contents);
      expect(fs.readdirSync(directory)).toEqual(['operator-state.json']);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
