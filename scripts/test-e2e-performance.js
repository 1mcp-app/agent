#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const rootDir = process.cwd();
const benchmarkRoot = join(rootDir, '.tmp', 'benchmarks', 'run-command');
const fixturePath = join(rootDir, 'test/e2e/fixtures/run-tool-server.js');
const buildCliPath = join(rootDir, 'build/index.js');

async function main() {
  if (!(await canBindLoopback())) {
    console.log('Skipping run-command benchmark: sandbox does not permit loopback listeners.');
    return;
  }

  await ensureBuild();

  const sandboxDir = join(benchmarkRoot, String(Date.now()));
  const configDir = join(sandboxDir, 'config');
  const configPath = join(configDir, 'mcp.json');
  const cachePath = join(configDir, '.cli-session');
  const servePort = await getAvailablePort();

  await mkdir(configDir, { recursive: true });
  await writeBenchmarkConfig(configPath);

  const serveProcess = spawn(
    'node',
    [
      buildCliPath,
      'serve',
      '--transport',
      'http',
      '--port',
      String(servePort),
      '--config',
      configPath,
      '--config-dir',
      configDir,
      '--no-enable-config-reload',
      '--log-level',
      'error',
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ONE_MCP_CONFIG: configPath,
        ONE_MCP_CONFIG_DIR: configDir,
        ONE_MCP_LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  try {
    await waitForServeReady(configDir, servePort);

    const coldDurations = [];
    for (let index = 0; index < 5; index += 1) {
      await unlink(cachePath).catch(() => {});
      coldDurations.push(
        await runTimedCommand(configDir, ['run', 'runner/echo_args', '--args', '{"message":"bench"}']),
      );
    }

    await unlink(cachePath).catch(() => {});
    await runTimedCommand(configDir, ['run', 'runner/echo_args', '--args', '{"message":"warm-prime"}']);
    await access(cachePath);

    const warmDurations = [];
    for (let index = 0; index < 10; index += 1) {
      warmDurations.push(
        await runTimedCommand(configDir, ['run', 'runner/echo_args', '--args', '{"message":"bench"}']),
      );
    }

    const rawInputDurations = [];
    for (let index = 0; index < 5; index += 1) {
      rawInputDurations.push(
        await runTimedCommand(configDir, ['run', 'runner/summarize', '--format', 'text'], {
          input: 'benchmark input text',
        }),
      );
    }

    printSummary('Cold explicit-args runs', coldDurations);
    printSummary('Warm explicit-args runs', warmDurations);
    printSummary('Warm raw-stdin runs', rawInputDurations);

    const coldMean = mean(coldDurations);
    const warmMean = mean(warmDurations);
    const speedup = coldMean > 0 ? coldMean / warmMean : 0;

    console.log('');
    console.log(`Cache file: ${cachePath}`);
    console.log(`Cold mean: ${coldMean.toFixed(1)}ms`);
    console.log(`Warm mean: ${warmMean.toFixed(1)}ms`);
    console.log(`Warm speedup vs cold: ${speedup.toFixed(2)}x`);
  } finally {
    await stopServe(serveProcess);
    await rm(sandboxDir, { recursive: true, force: true });
  }
}

async function ensureBuild() {
  console.log('Building with pnpm build...');
  await runProcess('pnpm', ['build'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
}

async function writeBenchmarkConfig(configPath) {
  const config = {
    mcpServers: {
      runner: {
        transport: 'stdio',
        command: 'node',
        args: [fixturePath],
        tags: ['benchmark', 'run'],
      },
    },
    servers: [
      {
        name: 'runner',
        transport: 'stdio',
        command: 'node',
        args: [fixturePath],
        tags: ['benchmark', 'run'],
      },
    ],
    transport: {
      http: {
        port: 0,
        host: '127.0.0.1',
      },
    },
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

async function waitForServeReady(configDir, servePort) {
  const pidPath = join(configDir, 'server.pid');
  const deadline = Date.now() + 15000;
  let lastError = 'server not ready';

  while (Date.now() < deadline) {
    try {
      const raw = await readFile(pidPath, 'utf8');
      const serverInfo = JSON.parse(raw);
      const expectedUrl = `http://127.0.0.1:${servePort}/mcp`;
      if (serverInfo.url !== expectedUrl) {
        throw new Error(`unexpected pid url: ${serverInfo.url}`);
      }

      const healthUrl = `http://127.0.0.1:${servePort}/oauth/`;
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status} from ${healthUrl}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for benchmark serve instance. Last error: ${lastError}`);
}

async function runTimedCommand(configDir, args, options = {}) {
  const startedAt = performance.now();
  await runProcess('node', [buildCliPath, ...args, '--config-dir', configDir, '--log-level', 'error'], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ONE_MCP_CONFIG_DIR: configDir,
      ONE_MCP_LOG_LEVEL: 'error',
    },
    input: options.input,
  });
  return performance.now() - startedAt;
}

async function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(`${command} ${args.join(' ')} failed with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`),
      );
    });

    if (options.input) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}

async function stopServe(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');

    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 5000).unref();
  });
}

function printSummary(label, durations) {
  console.log(`${label}: ${durations.map((duration) => `${duration.toFixed(1)}ms`).join(', ')}`);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate an available port.'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function canBindLoopback() {
  try {
    await getAvailablePort();
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
