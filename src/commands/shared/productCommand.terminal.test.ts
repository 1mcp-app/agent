import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('owned command terminal boundaries', () => {
  it.each([
    {
      name: 'registered handler failure',
      status: 1,
      signal: null,
      outcome: 'failure',
      source: `
      import yargs from 'yargs';
      import { setupPresetCommands } from './src/commands/preset/index.ts';
      import { PresetManager } from './src/domains/preset/manager/presetManager.ts';
      PresetManager.prototype.initialize = async () => { throw new Error('controlled initialization failure'); };
      await setupPresetCommands(yargs().exitProcess(false)).parseAsync(['preset','show','synthetic']);
    `,
    },
    {
      name: 'intentional zero terminal status',
      status: 0,
      signal: null,
      outcome: 'success',
      source: `
      import { runProductCommand, exitProductCommand } from './src/productTelemetry/commandScope.ts';
      await runProductCommand('preset', async()=>{ exitProductCommand(0); });
    `,
    },
    {
      name: 'default termination signal',
      status: null,
      signal: 'SIGTERM',
      // Windows forcefully terminates here without JavaScript signal delivery.
      // https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events
      outcome: process.platform === 'win32' ? null : 'failure',
      source: `
      import { runProductCommand } from './src/productTelemetry/commandScope.ts';
      await runProductCommand('preset', async()=>{
        setInterval(()=>{},1000); // Keep the fixture alive until the actual OS signal arrives.
        setImmediate(()=>process.kill(process.pid,'SIGTERM'));
        await new Promise(()=>{});
      });
    `,
    },
  ])('preserves $name with a best-effort completion hook', async ({ source, status, signal, outcome }) => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'product-command-terminal-'));
    const facts = path.join(scratch, 'facts.jsonl');
    const bundle = path.join(scratch, 'command.mjs');
    try {
      await build({
        stdin: { contents: source, resolveDir: root },
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'esm',
        banner: {
          js: `import { createRequire as terminalFixtureRequire } from 'node:module'; const require = terminalFixtureRequire(${JSON.stringify(path.join(root, 'package.json'))});`,
        },
        plugins: [
          {
            name: 'controlled-completion-hook',
            setup(builder) {
              builder.onResolve({ filter: /productTelemetry\/index\.js$/ }, () => ({
                path: 'fixture',
                namespace: 'controlled',
              }));
              builder.onLoad({ filter: /.*/, namespace: 'controlled' }, () => ({
                resolveDir: root,
                contents: `
            export * from ${JSON.stringify(path.join(root, 'src/productTelemetry/index.ts'))};
            import { appendFileSync } from 'node:fs';
            export const beginProductCommand = name => ({ finish(outcome) {
              appendFileSync(${JSON.stringify(facts)}, JSON.stringify({name,outcome})+'\\n');
            }});
          `,
              }));
            },
          },
        ],
      });
      const child = spawnSync(process.execPath, [bundle], {
        timeout: 5000,
        env: {
          ...process.env,
          ONE_MCP_CONFIG_DIR: path.join(scratch, 'scope'),
          ONE_MCP_PRODUCT_TELEMETRY: 'false',
          ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: 'true',
        },
        encoding: 'utf8',
      });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(status);
      expect(child.signal).toBe(signal);
      if (outcome === null) {
        await expect(fs.stat(facts)).rejects.toMatchObject({ code: 'ENOENT' });
        return;
      }
      expect(
        (await fs.readFile(facts, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ).toEqual([{ name: 'preset', outcome }]);
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });
});
