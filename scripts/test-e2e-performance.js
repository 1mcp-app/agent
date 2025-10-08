#!/usr/bin/env node

/**
 * Script to test E2E performance improvements
 * Tests both sequential and parallel execution with statistical analysis
 */

const { execSync } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');

/**
 * Run a command and measure its execution time
 */
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

/**
 * Create a temporary vitest configuration with specified worker count
 */
async function createTemporaryConfig(workerCount) {
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

  await fs.writeFile(configPath, configContent, 'utf8');
  return configPath;
}

/**
 * Clean up temporary configuration file
 */
async function cleanup(configPath) {
  try {
    // Check if file exists before attempting deletion
    if (fsSync.existsSync(configPath)) {
      await fs.unlink(configPath);
    }
  } catch (error) {
    // Ignore ENOENT errors (file doesn't exist)
    if (error.code !== 'ENOENT') {
      console.warn(`Warning: Failed to cleanup ${configPath}: ${error.message}`);
    }
  }
}

/**
 * Calculate statistical metrics for a set of durations
 */
function calculateStats(durations) {
  if (durations.length === 0) return null;

  const sum = durations.reduce((a, b) => a + b, 0);
  const mean = sum / durations.length;

  if (durations.length === 1) {
    return { mean, stddev: 0, min: mean, max: mean };
  }

  const variance = durations.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / durations.length;
  const stddev = Math.sqrt(variance);
  const min = Math.min(...durations);
  const max = Math.max(...durations);

  return { mean, stddev, min, max };
}

/**
 * Run performance tests with multiple iterations for statistical analysis
 */
async function main() {
  console.log('🔬 Testing E2E Performance Improvements');
  console.log('=====================================');

  const results = [];
  const iterations = process.env.PERF_ITERATIONS ? parseInt(process.env.PERF_ITERATIONS, 10) : 1;

  console.log(`Running ${iterations} iteration(s) for each configuration\n`);

  // Test 1: Sequential (baseline)
  console.log('\n📊 Test 1: Sequential Execution (Baseline)');
  let sequentialConfig;
  try {
    sequentialConfig = await createTemporaryConfig(1);
    const sequentialDurations = [];

    for (let i = 0; i < iterations; i++) {
      if (iterations > 1) console.log(`\nIteration ${i + 1}/${iterations}`);
      const result = runCommand(
        'pnpm build && pnpm test:e2e --config vitest.e2e.temp.config.ts',
        'Sequential execution (1 worker, baseline)',
      );
      if (result.success) {
        sequentialDurations.push(result.duration);
      }
    }

    const stats = calculateStats(sequentialDurations);
    results.push({
      name: 'Sequential',
      success: sequentialDurations.length > 0,
      stats,
      iterations: sequentialDurations.length,
    });
  } finally {
    if (sequentialConfig) {
      await cleanup(sequentialConfig);
    }
  }

  // Test 2: Multi-worker (fast strategy)
  console.log('\n📊 Test 2: Multi-Worker Execution');
  let multiWorkerConfig;
  try {
    multiWorkerConfig = await createTemporaryConfig(4);
    const multiWorkerDurations = [];

    for (let i = 0; i < iterations; i++) {
      if (iterations > 1) console.log(`\nIteration ${i + 1}/${iterations}`);
      const result = runCommand(
        'pnpm test:e2e --config vitest.e2e.temp.config.ts',
        'Multi-worker execution (4 workers, fast strategy)',
      );
      if (result.success) {
        multiWorkerDurations.push(result.duration);
      }
    }

    const stats = calculateStats(multiWorkerDurations);
    results.push({
      name: 'Multi-worker',
      success: multiWorkerDurations.length > 0,
      stats,
      iterations: multiWorkerDurations.length,
    });
  } finally {
    if (multiWorkerConfig) {
      await cleanup(multiWorkerConfig);
    }
  }

  // Test 3: Sharding simulation (run 1/4 of tests)
  console.log('\n📊 Test 3: Sharded Execution (CI Simulation)');
  let shardConfig;
  try {
    shardConfig = await createTemporaryConfig(2);
    const shardDurations = [];

    for (let i = 0; i < iterations; i++) {
      if (iterations > 1) console.log(`\nIteration ${i + 1}/${iterations}`);
      const result = runCommand(
        'pnpm test:e2e --config vitest.e2e.temp.config.ts --shard=1/4',
        'Sharded execution (1/4 of tests, simulated parallel strategy)',
      );
      if (result.success) {
        shardDurations.push(result.duration);
      }
    }

    // Calculate estimated full time for sharding (multiply by 4 since we ran 1/4)
    if (shardDurations.length > 0) {
      const estimatedStats = calculateStats(shardDurations.map((d) => d * 4));
      results.push({
        name: 'Sharded (estimated)',
        success: true,
        stats: estimatedStats,
        iterations: shardDurations.length,
        note: '1/4 execution time × 4 (parallel shards)',
      });
    } else {
      results.push({ name: 'Sharded (estimated)', success: false, stats: null, iterations: 0 });
    }
  } finally {
    if (shardConfig) {
      await cleanup(shardConfig);
    }
  }

  // Summary
  console.log('\n📊 Performance Results Summary');
  console.log('===============================\n');

  const baseline = results.find((r) => r.name === 'Sequential');

  if (baseline && baseline.success && baseline.stats) {
    // Print baseline
    console.log(`${baseline.name}:`);
    console.log(`  Mean: ${baseline.stats.mean.toFixed(0)}ms (${(baseline.stats.mean / 1000).toFixed(2)}s)`);
    if (baseline.iterations > 1) {
      console.log(`  Std Dev: ±${baseline.stats.stddev.toFixed(0)}ms`);
      console.log(`  Range: ${baseline.stats.min.toFixed(0)}ms - ${baseline.stats.max.toFixed(0)}ms`);
    }
    console.log(`  Iterations: ${baseline.iterations}\n`);

    // Print comparisons
    results.forEach((result) => {
      if (result.success && result.name !== 'Sequential' && result.stats) {
        const improvement = (((baseline.stats.mean - result.stats.mean) / baseline.stats.mean) * 100).toFixed(1);
        const speedup = (baseline.stats.mean / result.stats.mean).toFixed(2);

        console.log(`${result.name}:`);
        console.log(`  Mean: ${result.stats.mean.toFixed(0)}ms (${(result.stats.mean / 1000).toFixed(2)}s)`);
        if (result.iterations > 1) {
          console.log(`  Std Dev: ±${result.stats.stddev.toFixed(0)}ms`);
          console.log(`  Range: ${result.stats.min.toFixed(0)}ms - ${result.stats.max.toFixed(0)}ms`);
        }
        console.log(`  Speedup: ${speedup}x faster (${improvement}% improvement)`);
        if (result.note) {
          console.log(`  Note: ${result.note}`);
        }
        console.log(`  Iterations: ${result.iterations}\n`);
      } else if (!result.success) {
        console.log(`${result.name}: Failed ❌\n`);
      }
    });
  } else {
    console.log('❌ Baseline sequential test failed, cannot calculate improvements\n');
    results.forEach((result) => {
      if (result.success && result.stats) {
        console.log(`${result.name}: ${result.stats.mean.toFixed(0)}ms (${(result.stats.mean / 1000).toFixed(2)}s)`);
      } else {
        console.log(`${result.name}: Failed ❌`);
      }
    });
  }

  console.log('\n💡 Recommendations:');
  console.log('- Use "Multi-worker" strategy for local development (4 workers, single job)');
  console.log('- Use "Sharded" strategy for CI/CD (4 parallel jobs, ~4min runtime)');
  console.log('- Sequential execution provides baseline for comparison');
  console.log('\n📝 To run multiple iterations for statistical analysis:');
  console.log('   PERF_ITERATIONS=3 node scripts/test-e2e-performance.js');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
