#!/usr/bin/env node
// Real-version upgrade contract. Arguments: old build/index.js, candidate CLI (JS or SEA).
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const legacy = fs.realpathSync(process.argv[2]);
const candidate = fs.realpathSync(process.argv[3] ?? 'build/index.js');
const candidateMode = process.argv[4] ?? 'node';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ONE_MCP_')));
const scopes = [];
const records = ['runtime.owner/owner.json', 'background-runtime.json', 'server.pid', 'background-launch.json'];
const read = (scope, file) => JSON.parse(fs.readFileSync(path.join(scope, file), 'utf8'));
async function run(cli, scope, args) {
  const javascript = /\.[cm]?js$/.test(cli) && (cli !== candidate || candidateMode === 'node');
  const executable = cli === candidate && candidateMode === 'relative' ? `./${path.relative(scope, cli)}` : cli;
  return execute(
    javascript ? process.execPath : executable,
    [...(javascript ? [cli] : []), 'serve', '--config-dir', scope, ...args],
    {
      env,
      cwd: scope,
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
try {
  for (const operation of ['stop', 'restart']) {
    const scope = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '1mcp legacy upgrade ')));
    scopes.push(scope);
    fs.writeFileSync(path.join(scope, 'mcp.json'), '{"mcpServers":{}}');
    const listenPort = await port();
    const options = ['--host=127.0.0.1', `--port=${listenPort}`];
    if (operation === 'stop') {
      await run(legacy, scope, ['--background', ...options]);
    } else {
      // Match old default/inherited scope invocations without --config-dir in argv.
      const supervisor = spawn(process.execPath, [legacy, 'serve', '--background-bootstrap', ...options], {
        cwd: scope,
        env: { ...env, ONE_MCP_CONFIG_DIR: scope },
        stdio: 'ignore',
      });
      const deadline = Date.now() + 30000;
      while (true) {
        try {
          if (read(scope, 'background-runtime.json').status === 'running' && read(scope, 'server.pid').pid) break;
        } catch {
          /* startup */
        }
        if (supervisor.exitCode !== null || Date.now() > deadline)
          throw new Error('Inherited-scope fixture failed to start');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const oldOwner = read(scope, records[0]),
      oldInfo = read(scope, records[2]);
    assert.equal(oldOwner.processIdentity, undefined);
    assert.equal(oldInfo.processIdentity, undefined);
    await assert.rejects(
      run(candidate, scope, ['--status']),
      (error) => error.code === 2 && /Legacy metadata/.test(error.stdout),
    );
    assert.deepEqual(read(scope, records[0]), oldOwner);

    // A copied generation is not ownership of a different selected scope.
    const copy = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '1mcp legacy copy ')));
    fs.cpSync(scope, copy, { recursive: true });
    const copiedRecords = records.map((name) => fs.readFileSync(path.join(copy, name), 'utf8'));
    await assert.rejects(
      run(candidate, copy, ['--stop']),
      (error) => error.code === 1 && /cannot verify/.test(error.stderr),
    );
    assert.deepEqual(
      records.map((name) => fs.readFileSync(path.join(copy, name), 'utf8')),
      copiedRecords,
    );
    fs.rmSync(copy, { recursive: true });
    assert.equal(
      (await fetch(`http://127.0.0.1:${listenPort}/health/ready`, { signal: AbortSignal.timeout(5000) })).status,
      200,
    );

    if (process.platform === 'linux') {
      const output = await run(candidate, scope, [`--${operation}`, ...options]);
      assert.match(output.stdout, /Stopped verified legacy background runtime/);
    } else {
      const before = records.map((name) => fs.readFileSync(path.join(scope, name), 'utf8'));
      await assert.rejects(
        run(candidate, scope, [`--${operation}`, ...options]),
        (error) => error.code === 1 && /original CLI or service manager/.test(error.stderr),
      );
      assert.deepEqual(
        records.map((name) => fs.readFileSync(path.join(scope, name), 'utf8')),
        before,
      );
      assert.equal(
        (await fetch(`http://127.0.0.1:${listenPort}/health/ready`, { signal: AbortSignal.timeout(5000) })).status,
        200,
      );
      // This fixture owns the old process; guided migration leaves this step to the operator.
      await run(legacy, scope, ['--stop']);
      if (operation === 'restart') await run(candidate, scope, ['--background', ...options]);
    }
    if (operation === 'restart') {
      const updated = read(scope, records[2]);
      assert(updated.processIdentity);
      assert.notEqual(updated.pid, oldInfo.pid);
      assert(read(scope, records[0]).processIdentity);
      assert.equal(
        (await fetch(`http://127.0.0.1:${listenPort}/health/ready`, { signal: AbortSignal.timeout(5000) })).status,
        200,
      );
      await run(candidate, scope, ['--restart', ...options]);
      assert.match((await run(candidate, scope, ['--status'])).stdout, /Readiness .*ready/);
      await run(candidate, scope, ['--stop']);
    }
    assert(!fs.existsSync(path.join(scope, 'runtime.owner')));
    assert(!fs.existsSync(path.join(scope, 'server.pid')));
    console.log(
      `PASS ${process.platform}/${process.arch}: v0.38.0 ${process.platform === 'linux' ? 'automatic' : 'guided'} --${operation}; scope safety and modern lifecycle`,
    );
  }
} finally {
  for (const scope of scopes) {
    if (fs.existsSync(path.join(scope, 'runtime.owner'))) {
      // Only this harness's freshly created scopes, using the old CLI for teardown.
      try {
        await run(legacy, scope, ['--stop']);
      } catch (error) {
        console.error(`Fixture teardown failed: ${error.message}`);
      }
    }
    if (!fs.existsSync(path.join(scope, 'runtime.owner'))) fs.rmSync(scope, { recursive: true, force: true });
  }
}
