#!/usr/bin/env node

/**
 * Script to test E2E performance improvements
 * Tests both sequential and parallel execution
 */

const { execSync } = require('child_process');
const fs = require('fs');

function runCommand(command, description) {
  console.log(`\n🚀 ${description}`);
  console.log(`Running: ${command}`);

  const startTime = Date.now();

  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'inherit',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    const duration = Date.now() - startTime;
    console.log(`✅ Completed in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    return { success: true, duration, output };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`❌ Failed in ${duration}ms`);
    console.log(`Error: ${error.message}`);
    return { success: false, duration, error: error.message };
  }
}

function createTemporaryConfig(workerCount) {
  const configPath = 'vitest.e2e.temp.config.ts';
  const configContent = `
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.test.ts'],
    globals: true,
    testTimeout: 60000,
    hookTimeout: 30000,

    // Configure for ${workerCount} workers
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: ${workerCount},
        singleFork: false,
      },
    },

    fileParallelism: true,
    maxConcurrency: ${workerCount},

    retry: 1,
    teardownTimeout: 15000,
    alias: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    coverage: { enabled: false },
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
    },
    reporters: ['basic'],
    globalSetup: ['test/e2e/setup/global-setup.ts'],
  },
});
`;

  fs.writeFileSync(configPath, configContent);
  return configPath;
}

function cleanup(configPath) {
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

async function main() {
  console.log('🔬 Testing E2E Performance Improvements');
  console.log('=====================================');

  const results = [];

  // Test 1: Sequential (baseline)
  const sequentialConfig = createTemporaryConfig(1);
  const sequentialResult = runCommand(
    'pnpm build && pnpm test:e2e --config vitest.e2e.temp.config.ts',
    'Sequential execution (1 worker, baseline)',
  );
  results.push({ name: 'Sequential', ...sequentialResult });
  cleanup(sequentialConfig);

  // Test 2: Multi-worker (fast strategy)
  const multiWorkerConfig = createTemporaryConfig(4);
  const multiWorkerResult = runCommand(
    'pnpm test:e2e --config vitest.e2e.temp.config.ts',
    'Multi-worker execution (4 workers, fast strategy)',
  );
  results.push({ name: 'Multi-worker', ...multiWorkerResult });
  cleanup(multiWorkerConfig);

  // Test 3: Sharding simulation (run 1/4 of tests)
  console.log('\n🔀 Testing sharding performance...');
  const shardConfig = createTemporaryConfig(2);
  const shardResult = runCommand(
    'pnpm test:e2e --config vitest.e2e.temp.config.ts --shard=1/4',
    'Sharded execution (1/4 of tests, simulated parallel strategy)',
  );
  cleanup(shardConfig);

  // Calculate estimated full time for sharding
  if (shardResult.success) {
    const estimatedFullTime = shardResult.duration * 4;
    results.push({
      name: 'Sharded (estimated)',
      success: true,
      duration: estimatedFullTime,
      note: '1/4 execution time multiplied by 4',
    });
  } else {
    results.push({ name: 'Sharded (estimated)', success: false, duration: 0 });
  }

  // Summary
  console.log('\n📊 Performance Results Summary');
  console.log('===============================');

  const baseline = results.find((r) => r.name === 'Sequential');
  if (baseline && baseline.success) {
    results.forEach((result) => {
      if (result.success && result.name !== 'Sequential') {
        const improvement = (((baseline.duration - result.duration) / baseline.duration) * 100).toFixed(1);
        const speedup = (baseline.duration / result.duration).toFixed(2);
        console.log(
          `${result.name}: ${result.duration}ms (${speedup}x faster, ${improvement}% improvement) ${result.note ? `(${result.note})` : ''}`,
        );
      } else if (result.success) {
        console.log(`${result.name}: ${result.duration}ms (baseline)`);
      } else {
        console.log(`${result.name}: Failed ❌`);
      }
    });
  } else {
    console.log('❌ Baseline sequential test failed, cannot calculate improvements');
    results.forEach((result) => {
      console.log(`${result.name}: ${result.success ? `${result.duration}ms` : 'Failed ❌'}`);
    });
  }

  console.log('\n💡 Recommendations:');
  console.log('- Use "Fast" strategy for most CI runs (multi-worker, single job)');
  console.log('- Use "Parallel" strategy for maximum speed (sharding, multiple jobs)');
  console.log('- Sequential execution provides baseline comparison');
}

if (require.main === module) {
  main().catch(console.error);
}
